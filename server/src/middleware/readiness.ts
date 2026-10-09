import mongoose from 'mongoose';
export let draining = false;
export function startDraining() {
  draining = true;
}
let checked = 0;
let connected = false;
let pending: Promise<boolean> | undefined;
export async function ready() {
  if (draining || mongoose.connection.readyState !== 1) return false;
  if (Date.now() - checked < 2000) return connected;
  if (!pending)
    pending = (async () => {
      try {
        await mongoose.connection
          .db!.admin()
          .command({ ping: 1 }, { timeoutMS: 1500 });
        connected = true;
      } catch {
        connected = false;
      }
      checked = Date.now();
      pending = undefined;
      return connected;
    })();
  return pending;
}
