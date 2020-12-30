import { readFileSync } from 'fs-extra';

export const NO_PERMISSION_ERROR = "You don't have permission to do that";

export const config: Config = JSON.parse(readFileSync('./config.json').toString());

interface Config {
    db: {
        user: string;
        password: string;
        host: string;
        port: number;
        database: string;
        software: string;
    };
    basePath: string;
    bdsDownloads: string;
    server?: {
        host: string;
        port: number;
    }
}