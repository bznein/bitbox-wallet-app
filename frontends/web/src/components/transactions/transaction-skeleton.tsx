// SPDX-License-Identifier: Apache-2.0

import { Skeleton } from '@/components/skeleton/skeleton';
import skeletonStyles from '@/components/skeleton/skeleton.module.css';
import stylesTx from './transaction.module.css';
import stylesTxSkeleton from './transaction-skeleton.module.css';

export const TransactionSkeleton = () => {
  return (
    <section className={stylesTx.tx}>
      <div className={`${stylesTxSkeleton.txContentSkeleton || ''} ${skeletonStyles.delayed || ''}`}>
        <Skeleton minWidth="32px" />
        <div className={stylesTxSkeleton.txInfoColumnSkeleton}>
          <Skeleton minWidth="70%" className={stylesTxSkeleton.skeletonStatus} />
          <Skeleton minWidth="20%" className={stylesTxSkeleton.skeletonStatus} />
        </div>
      </div>
    </section>
  );
};
