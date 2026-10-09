import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { migrate, auditInvariants, retain } from './maintenance.js';
const command = process.argv[2];
try {
  if (!['migrate', 'audit', 'retention'].includes(command))
    throw new Error('Use migrate, audit or retention');
  await connectDatabase(true);
  if (
    (command === 'migrate' || process.argv.includes('--apply')) &&
    process.env.DB_ADMIN_CONFIRM !== mongoose.connection.name
  )
    throw new Error(
      'Set DB_ADMIN_CONFIRM to the exact target database name before writes',
    );
  if (command === 'migrate') {
    await migrate();
    console.info('Migration complete');
  }
  if (command === 'audit')
    console.info(JSON.stringify(await auditInvariants()));
  if (command === 'retention')
    console.info(
      JSON.stringify({
        apply: process.argv.includes('--apply'),
        ...(await retain(process.argv.includes('--apply'))),
      }),
    );
} catch (error) {
  console.error(
    error instanceof Error && !/Mongo/.test(error.name)
      ? error.message
      : 'Database maintenance failed',
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
