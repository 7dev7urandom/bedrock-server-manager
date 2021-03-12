import { readdir } from 'fs/promises';
import { BServer } from './BServer';

export default class PluginSystem {
    static plugins = new Set<any>();
    static serverStoppedListeners: CallableFunction[] = [];
    static serverStartedListeners: CallableFunction[] = [];

    static async initalizePluginSystem() {
        const plugins = (await readdir('plugins', {
            withFileTypes: true
        })).filter(x => x.isDirectory());
        plugins.forEach(plugin => {
            // const { serverStopped, serverStarted } = ;
            this.plugins.add(require('../plugins/' + plugin.name + '/index'));
        });
    }

    static onServerStarted(callback: CallableFunction) {
        this.serverStartedListeners.push(callback);
    }
    static onServerStopped(callback: CallableFunction) {
        this.serverStoppedListeners.push(callback);
    }

    static serverStarted(server: BServer) {
        this.serverStartedListeners.forEach(x => x(server));
    }
    static serverStopped(server: BServer) {
        this.serverStoppedListeners.forEach(x => x(server));
    }
}