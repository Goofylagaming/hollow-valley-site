import fs from "node:fs";
import path from "node:path";
import {backupConfig,s3BackingStore,preserveLegacyDisk} from "./offsite-backups.mjs";

/**
 * Opt-in, read-only-with-respect-to-Hollow-Valley preflight.
 * Copies all recognized legacy database and recovery files to encrypted
 * off-site object storage, reads them back, and compares hashes.
 *
 * No SQLite migration, deletion, registration, or cloud cutover occurs here.
 */
export async function performBackupPreflight({env=process.env,store,logger=console}={}){
 const root=env.PRIMALBOUND_DATA_ROOT||"/app/data";
 if(!path.isAbsolute(root)||!fs.existsSync(root)||!fs.statSync(root).isDirectory()){
  throw new Error("Paid persistent data root is missing");
 }
 const config=backupConfig(env);
 if(!config)throw new Error("R2 off-site backup configuration is incomplete");
 const backingStore=store||await s3BackingStore(config);
 const target=path.join(root,"primalbound-cloud");
 const verified=await preserveLegacyDisk(root,target,backingStore,config);
 if(!verified?.files?.length)throw new Error("No original database or recovery files were verified");
 logger.info("[PB R2 preflight] VERIFIED: "+verified.files.length+" original disk artifacts encrypted, uploaded, downloaded, decrypted and hash-checked");
 logger.info("[PB R2 preflight] Original Hollow Valley files unchanged. SQLite migration and account cutover are still disabled.");
 return {ok:true,files:verified.files.length,verifiedAt:verified.verifiedAt};
}
