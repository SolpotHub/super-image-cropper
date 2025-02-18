import type Cropper from 'cropperjs';
import { Decoder } from './lib/decoder';
import { SyntheticGIF } from './lib/synthetic-gif';
import { FrameCropper } from './lib/cropper';
import {
  getImageInfo,
  loadImage,
  IImageLoadData
} from './lib/helper';
import type { IParsedFrameInfo } from './lib/decoder';
export interface CustomCropper extends Cropper {
  url: '';
  cropBoxData: Cropper.ImageData;
  canvasData: Cropper.ImageData;
  cropper?: HTMLDivElement;
}

export enum OutputType {
  BASE64 = 'base64',
  BLOB = 'blob',
  BLOB_URL = 'blobURL'
}

export type IOutputTypeUnion = `${OutputType}`;
export interface ICropperOptions {
  cropperInstance?: CustomCropper | Cropper;
  src?: string;
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  cropperJsOpts?: ICropOpts;
  gifJsOptions?: IGifOpts;
  outputType?: IOutputTypeUnion;
  quality?: number;
}

export interface IGifOpts {
  repeat?: number;
  quality?: number;
  workers?: number;
  workerScript?: string;
  background?: string;
  width?: number;
  height?: number;
  transparent?: string | null;
  dither?: boolean;
  debug?: boolean;
}

export interface ICropOpts {
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  x?: number;
  y?: number;
  background?: string;
  rotate?: number;
  left?: number;
  top?: number;
}

export interface IImageData {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export interface ICommonCropOptions {
  cropperJsOpts: Required<ICropOpts>;
  imageData: IImageData;
  cropBoxData: Cropper.CropBoxData;
}

export class SuperImageCropper {
  private cropperJsInstance?: CustomCropper;
  private parsedFrameInfo!: IParsedFrameInfo;
  private commonCropOptions!: ICommonCropOptions;
  private frameCropperInstance!: FrameCropper;
  private inputCropperOptions!: ICropperOptions;
  // private imageTypeInfo: IImageTypeInfo | null = null;

  public async crop(inputCropperOptions: ICropperOptions): Promise<string | Blob> {
    this.userInputValidator(inputCropperOptions);
    this.inputCropperOptions = this.cleanUserInput(inputCropperOptions);
    await this.init();
    await this.decodeGIF();

    const checkResult = await this.checkIsStaticImage();
    if (checkResult.isStatic) {
      return this.handleStaticImage(checkResult.imageInfo);
    } else {
      const resultFrames = await this.cropFrames();
      return this.saveGif(resultFrames, this.parsedFrameInfo?.delays || []);
    }
  }

  private async init() {
    this.cropperJsInstance = this.inputCropperOptions.cropperInstance as CustomCropper;
    // 合并初始值
    const defaultOptions: ICropOpts = {
      width: 100,
      height: 100,
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
      rotate: 0,
      left: 0,
      top: 0
    };
    const targetConfig = Object.assign(
      defaultOptions,
      this.inputCropperOptions.cropperJsOpts || {},
      this.cropperJsInstance?.getData() || {}
    );

    const imageData =
      this.cropperJsInstance?.getImageData() ||
      (await getImageInfo({
        src: this.inputCropperOptions.src,
        crossOrigin: this.inputCropperOptions.crossOrigin
      })) ||
      {};
    this.commonCropOptions = {
      cropperJsOpts: this.imageDataFormat(targetConfig, imageData),
      imageData,
      cropBoxData: this.cropperJsInstance?.getCropBoxData() || targetConfig
    };

    this.commonCropOptions.cropperJsOpts.rotate = this.normalizeRotate(
      this.commonCropOptions.cropperJsOpts.rotate
    );
  }

  private cleanUserInput(cropperOptions: ICropperOptions) {
    const { cropperInstance } = cropperOptions;
    if (cropperInstance) {
      delete cropperOptions['cropperJsOpts'];
      delete cropperOptions['src'];
    }
    return cropperOptions;
  }

  private userInputValidator(cropperOptions: ICropperOptions) {
    const { cropperInstance, cropperJsOpts, src } = cropperOptions;
    if (!cropperInstance) {
      if (!cropperJsOpts) {
        throw new Error('If cropperInstance is not specified, cropperJsOpts must be specified.');
      } else if (!src) {
        throw new Error('If cropperInstance is not specified, src must be specified.');
      }
    }
  }

  private normalizeRotate(rotation: number): number {
    return rotation < 0 ? 360 + (rotation % 360) : rotation;
  }

  private imageDataFormat(
    targetConfig: ICropOpts & Cropper.Data,
    imageData: IImageData
  ): Required<ICropOpts> {
    targetConfig.left = targetConfig.x;
    targetConfig.top = targetConfig.y;
    targetConfig.width = targetConfig.width || imageData.naturalWidth;
    targetConfig.height = targetConfig.height || imageData.naturalHeight;
    return targetConfig as Required<ICropOpts>;
  }

  private async decodeGIF(): Promise<void> {
    const decoder = new Decoder(this.inputCropperOptions.src || this.cropperJsInstance?.url || '');
    const parsedFrameInfo = await decoder.decompressFrames();
    this.parsedFrameInfo = parsedFrameInfo;
  }

  private ensureFrameCropperExist() {
    if (!this.frameCropperInstance) {
      this.frameCropperInstance = new FrameCropper({
        commonCropOptions: this.commonCropOptions
      });
    }
  }

  private async cropFrames() {
    this.ensureFrameCropperExist();
    this.frameCropperInstance.init({
      commonCropOptions: this.commonCropOptions
    });
    return this.frameCropperInstance.cropGif(this.parsedFrameInfo);
  }

  private async saveGif(resultFrames: ImageData[], frameDelays: number[]) {
    const syntheticGIF = new SyntheticGIF({
      frames: resultFrames,
      commonCropOptions: this.commonCropOptions,
      frameDelays,
      gifJsOptions: this.inputCropperOptions.gifJsOptions,
      outputType: this.inputCropperOptions.outputType
    });
    return syntheticGIF.bootstrap();
  }

  private async checkIsStaticImage() {
    const url = this.cropperJsInstance?.url ?? this.inputCropperOptions?.src;
    const imageInfo = await loadImage({
      src: url,
      crossOrigin: this.inputCropperOptions.crossOrigin
    });
    return {
      isStatic: imageInfo?.imageType?.mime !== 'image/gif',
      imageInfo
    };
  }

  private async handleStaticImage(imageInfo: IImageLoadData): Promise<string | Blob> {
    const { imageInstance, imageType } = imageInfo;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = imageInstance.width;
    canvas.height = imageInstance.height;
    ctx?.drawImage(imageInstance, 0, 0);

    this.ensureFrameCropperExist();
    // 每次重新裁剪需要初始化一下裁剪区域相关数据
    this.frameCropperInstance.init({
      commonCropOptions: this.commonCropOptions
    });
    const croppedImageData = await this.frameCropperInstance.cropStaticImage(canvas);
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = croppedImageData.width;
    canvas.height = croppedImageData.height;
    ctx?.putImageData(croppedImageData, 0, 0);

    return new Promise((resolve, reject) => {
      const { outputType = OutputType.BLOB_URL } = this.inputCropperOptions;
      const quality = (this.inputCropperOptions?.quality ?? 100) / 100;

      if (outputType === OutputType.BASE64) {
        resolve(canvas.toDataURL(imageType?.mime, quality));
      } else {
        canvas.toBlob(
          blob => {
            if (!blob) return reject(null);
            if (outputType === OutputType.BLOB) {
              resolve(blob);
            } else {
              const blobUrl = window.URL.createObjectURL(blob);
              resolve(blobUrl);
            }
          },
          imageType?.mime,
          quality
        );
      }
    });
  }
}
