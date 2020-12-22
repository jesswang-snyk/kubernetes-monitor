import { unlink } from 'fs';
import { PluginResponse, scan } from 'snyk-docker-plugin';
import { DepGraph, legacy } from '@snyk/dep-graph';

import { logger } from '../../common/logger';
import { pull as skopeoCopy, getDestinationForImage } from './skopeo';
import { IPullableImage, IScanImage } from './types';
import { IScanResult } from '../types';
import {
  buildDockerPropertiesOnDepTree,
  DependencyTree,
  extractFactsFromDockerPluginResponse,
  LegacyPluginResponse,
} from './docker-plugin-shim';

export async function pullImages(images: IPullableImage[]): Promise<IPullableImage[]> {
  const pulledImages: IPullableImage[] = [];

  for (const image of images) {
    const { imageName, imageWithDigest, fileSystemPath } = image;
    if (!fileSystemPath) {
      continue;
    }

    try {
      // Scan image by digest if exists, other way fallback tag
      const scanId = imageWithDigest ?? imageName;
      await skopeoCopy(scanId, fileSystemPath);
      pulledImages.push(image);
    } catch (error) {
      logger.error({error, image: imageWithDigest}, 'failed to pull image');
    }
  }

  return pulledImages;
}

export function getImagesWithFileSystemPath(images: IScanImage[]): IPullableImage[] {
  return images.map((image) => ({ ...image, fileSystemPath: getDestinationForImage(image.imageName) }));
}

export async function removePulledImages(images: IPullableImage[]): Promise<void> {
  for (const {imageName, fileSystemPath} of images) {
    try {
      await new Promise((resolve) => unlink(fileSystemPath, resolve));
    } catch (error) {
      logger.warn({error, image: imageName}, 'failed to delete pulled image');
    }
  }
}

// Exported for testing
export function getImageParts(imageWithTag: string) : {imageName: string, imageTag: string, imageDigest: string} {
  // we're matching pattern: <registry:port_number>(optional)/<image_name>(mandatory):<image_tag>(optional)@<tag_identifier>(optional)
  // extracted from https://github.com/docker/distribution/blob/master/reference/regexp.go
  const regex = /^((?:(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])(?:(?:\.(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]))+)?(?::[0-9]+)?\/)?[a-z0-9]+(?:(?:(?:[._]|__|[-]*)[a-z0-9]+)+)?(?:(?:\/[a-z0-9]+(?:(?:(?:[._]|__|[-]*)[a-z0-9]+)+)?)+)?)(?::([\w][\w.-]{0,127}))?(?:@([A-Za-z][A-Za-z0-9]*(?:[-_+.][A-Za-z][A-Za-z0-9]*)*[:][A-Fa-f0-9]{32,}))?$/ig;
  const groups  = regex.exec(imageWithTag);

  if(!groups){
    logger.error({image: imageWithTag}, 'Image with tag is malformed, cannot extract valid parts');
    return { imageName: imageWithTag, imageTag: '', imageDigest: '' };
  }

  const IMAGE_NAME_GROUP = 1;
  const IMAGE_TAG_GROUP = 2;
  const IMAGE_DIGEST_GROUP = 3;

  return {
    imageName: groups[IMAGE_NAME_GROUP],
    imageTag: groups[IMAGE_TAG_GROUP] || '',
    imageDigest: groups[IMAGE_DIGEST_GROUP] || '',
  };
}

export async function scanImages(images: IPullableImage[]): Promise<IScanResult[]> {
  const scannedImages: IScanResult[] = [];

  for (const { imageName, fileSystemPath, imageWithDigest } of images) {
    try {
      const shouldIncludeAppVulns = false;
      const dockerArchivePath = `docker-archive:${fileSystemPath}`;

      const pluginResponse = await scan({
        path: dockerArchivePath,
        imageNameAndTag: imageName,
        'app-vulns': shouldIncludeAppVulns,
      });

      if (
        !pluginResponse ||
        !Array.isArray(pluginResponse.scanResults) ||
        pluginResponse.scanResults.length === 0
      ) {
        throw Error('Unexpected empty result from docker-plugin');
      }

      const depTree = await getDependencyTreeFromPluginResponse(pluginResponse, imageName);

      const imageParts = getImageParts(imageName);
      const imageDigest = imageWithDigest && getImageParts(imageWithDigest).imageDigest;

      const result: LegacyPluginResponse = getLegacyPluginResponse(depTree, imageParts, imageDigest);

      scannedImages.push({
        image: imageParts.imageName,
        imageWithTag: imageName,
        imageWithDigest: imageWithDigest,
        pluginResult: result,
      });
    } catch (error) {
      logger.warn({error, image: imageName}, 'failed to scan image');
    }
  }

  return scannedImages;
}

function getLegacyPluginResponse(
  depTree: DependencyTree,
  imageParts: { imageName: string; imageTag: string; imageDigest: string },
  imageDigest: string | undefined,
): LegacyPluginResponse {
  return {
    package: depTree,
    manifestFiles: [],
    plugin: {
      name: 'snyk-docker-plugin',
      imageLayers: depTree.docker?.imageLayers || [],
      dockerImageId:
        depTree.dockerImageId || depTree.docker?.dockerImageId || '',
      packageManager: depTree.type,
      runtime: undefined,
    },
    imageMetadata: {
      image: imageParts.imageName,
      imageTag: imageParts.imageTag,
      imageDigest,
    },
    hashes: depTree.docker?.hashes || [],
  };
}

/**
 * Converts from the new plugin format back to the old DependencyTree format.
 * May throw if the expected data is missing.
 */
async function getDependencyTreeFromPluginResponse(
  pluginResponse: PluginResponse,
  imageName: string,
): Promise<DependencyTree> {
  const osDepGraph:
    | DepGraph
    | undefined = pluginResponse.scanResults[0].facts.find(
    (fact) => fact.type === 'depGraph',
  )?.data;

  if (!osDepGraph) {
    throw new Error('Missing dependency graph');
  }

  const depTree = await legacy.graphToDepTree(
    osDepGraph,
    osDepGraph.pkgManager.name,
  );
  const osScanResultFacts = extractFactsFromDockerPluginResponse(
    pluginResponse,
  );
  const dockerDepTree = buildDockerPropertiesOnDepTree(
    depTree,
    osScanResultFacts,
    imageName,
  );
  return dockerDepTree;
}
