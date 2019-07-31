/***
 * consider using https://www.npmjs.com/package/kubernetes-client
 * currently it's better to not use this lib since version 9.0 is about to be
 * released and merged with oficial @kubernetes/client-node.
 * IMPORTANT:
 * see: https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.14/#-strong-api-overview-strong-
 */
import logger = require('../../common/logger');
import { deleteHomebaseWorkload, sendDepGraph } from '../../transmitter';
import { constructHomebaseDeleteWorkloadPayloads, constructHomebaseWorkloadPayloads } from '../../transmitter/payload';
import { IDepGraphPayload, IKubeImage, IScanResponse } from '../../transmitter/types';
import { pullImages } from '../images';
import { scanImages, ScanResult } from './image-scanner';

export = class WorkloadWorker {
  private readonly logId: string;

  constructor(logId: string) {
    this.logId = logId;
  }

  public async process(workloadMetadata: IKubeImage[]): Promise<IScanResponse> {
    const logId = this.logId;
    const allImages = workloadMetadata.map((meta) => meta.imageName);
    logger.info({logId, imageCount: allImages.length}, 'Queried workloads');
    const uniqueImages = [...new Set<string>(allImages)];

    logger.info({logId, imageCount: uniqueImages.length}, 'Pulling unique images');
    const pulledImages = await pullImages(uniqueImages);

    logger.info({logId, imageCount: pullImages.length}, 'Scanning pulled images');
    const scannedImages: ScanResult[] = await scanImages(pulledImages);
    logger.info({logId, imageCount: scannedImages.length}, 'Successfully scanned images');

    const homebasePayloads: IDepGraphPayload[] = constructHomebaseWorkloadPayloads(scannedImages, workloadMetadata);
    await sendDepGraph(...homebasePayloads);

    const pulledImageMetadata = workloadMetadata.filter((meta) =>
      pulledImages.includes(meta.imageName));

    logger.info({logId, imageCount: pulledImageMetadata.length}, 'Processed images');

    return { imageMetadata: pulledImageMetadata };
  }

  public async delete(workloadMetadata: IKubeImage[]) {
    const deletePayloads = constructHomebaseDeleteWorkloadPayloads(workloadMetadata);
    const deletedWorkloadNames = workloadMetadata.map((workload) => workload.name);
    logger.info({logId: this.logId, workloadCount: deletedWorkloadNames.length, workload: deletedWorkloadNames},
      'Removing workloads from homebase');
    await deleteHomebaseWorkload(deletePayloads);
  }
};
