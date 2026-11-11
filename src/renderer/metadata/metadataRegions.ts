import type { OnlineMetadataResult } from '../types';

export const metadataRegionLabels: Record<NonNullable<OnlineMetadataResult['country']>, string> = {
  TW: '台灣區',
  HK: '香港區',
  US: '美國區',
  JP: '日本區',
  GB: '英國區',
  CA: '加拿大區',
  AU: '澳洲區',
  SG: '新加坡區'
};
