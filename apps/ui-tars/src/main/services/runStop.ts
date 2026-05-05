/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

let globalStopEpoch = 0;

export const requestGlobalStop = (): number => {
  globalStopEpoch += 1;
  return globalStopEpoch;
};

export const getGlobalStopEpoch = (): number => {
  return globalStopEpoch;
};

export const hasGlobalStopSince = (epoch: number): boolean => {
  return globalStopEpoch !== epoch;
};
