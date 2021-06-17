import { config } from './Constants';
import { BServer } from './classes/BServer';
import { Server } from './Server';
import { addListeners } from './classes/Listener';
import { createInterface } from 'readline';
import Database from './classes/DatabaseImpl';
import PluginSystem from './classes/Plugins';

export const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

PluginSystem.initalizePluginSystem();
Server.start();

addListeners();

Database.initializeDatabaseData(config).then(() => Server.listen());

function pKill() {
    console.log("Servers stopping");
    const proms = [];
    try {
        BServer.servers.forEach(s => proms.push(s.stop(true)));
    } catch {
        console.error("Error stopping servers. Ending now.");
        process.exit();
    }
    Promise.all(proms).then(() => {
        console.log("Exiting");
        Server.io.emit("logout");
        process.exit();
    }).catch(() => {
        process.exit();
    });
}
rl.on('SIGINT', pKill);
process.on('SIGTERM', pKill);
process.on('SIGINT', pKill);

//catches uncaught exceptions
process.on('uncaughtException', (err, origin) => {
    console.error(err);
    console.error(`Error in ${origin}`);
    pKill();
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    pKill();
});
