const { probeDinoStorageConfig } = require('./dinoStorageConfigProbe');
setTimeout(() => {
  probeDinoStorageConfig().catch((error) => {
    console.log(`[dinostorage-config-probe] failed=${String(error?.code || error?.name || 'unknown')}`);
  });
}, 2500).unref?.();
