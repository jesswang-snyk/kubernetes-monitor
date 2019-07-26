import { V1Deployment } from '@kubernetes/client-node';
import * as uuidv4 from 'uuid/v4';
import { WatchEventType } from '../types';
import { deleteWorkload } from './index';

export async function deploymentWatchHandler(eventType: string, deployment: V1Deployment) {
  if (eventType !== WatchEventType.Deleted) {
    return;
  }

  const logId = uuidv4().substring(0, 8);

  await deleteWorkload({
    kind: 'Deployment',
    objectMeta: deployment.metadata,
    specMeta: deployment.spec.template.metadata,
    containers: deployment.spec.template.spec.containers,
    ownerRefs: deployment.metadata.ownerReferences,
  }, logId);
}
