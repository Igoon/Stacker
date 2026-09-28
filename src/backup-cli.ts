import "dotenv/config";
import path from "node:path";
import { runBackup } from "./backup";

runBackup()
  .then((p) => {
    console.log(p ? "backup dibuat: " + path.basename(p) : "backup hari ini sudah ada");
  })
  .catch((e) => {
    console.error("backup gagal:", (e as Error).message);
    process.exitCode = 1;
  });