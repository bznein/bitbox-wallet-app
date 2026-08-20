// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from '@/components/skeleton/skeleton';
import skeletonStyle from '@/components/skeleton/skeleton.module.css';
import style from './balance-skeleton.module.css';

export const BalanceSkeleton = () => {
  return (
    <div className={`${style.skeletonContainer || ''} ${skeletonStyle.delayed || ''}`}>
      <Skeleton className={style.skeletonBalance} minWidth="50%"/>
    </div>
  );
};
