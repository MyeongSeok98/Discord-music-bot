// Lookup must be side-effect free: only enqueue after both tasks succeed.
async function prepareInParallel(connect, lookup) {
  const [voice, metadata] = await Promise.allSettled([
    Promise.resolve().then(connect), Promise.resolve().then(lookup)
  ]);
  if (voice.status === 'rejected') throw voice.reason;
  if (metadata.status === 'rejected') throw metadata.reason;
  return { connection: voice.value, request: metadata.value };
}

module.exports = { prepareInParallel };
