import NoSleep from 'nosleep.js';

let noSleepInstance: any = null;

export const getNoSleep = () => {
  if (typeof window === 'undefined') return null;
  if (!noSleepInstance) {
    noSleepInstance = new NoSleep();
  }
  return noSleepInstance;
};
