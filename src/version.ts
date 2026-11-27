// Sumber tunggal versi aplikasi dari package.json (dibundle saat build & runtime tsx).
import pkg from "../package.json";

export const APP_VERSION: string = pkg.version;
