import { ServerPermissions, System } from './Constants';
import { BServer, ServerNotFoundError } from './classes/BServer'
import { readFileSync } from 'fs';
import { Server } from './Server';
import DatabaseConnection from './classes/DatabaseConnection';
import path = require('path');
import { propertiesFileToBProperties, permissionsFileToBPermissions } from './LocalUtil'
import config from './config';

var servers: BServer[] = [];


DatabaseConnection.connect(config);
Server.start(readFileSync(path.join(__dirname, 'browser/index.html'), 'utf-8'));

addListeners();

DatabaseConnection.query({
    // rowMode: 'array',
    text: 'SELECT * FROM servers',
}).then(result => {
    result.rows.forEach(server => {
        const propertiesPromise = propertiesFileToBProperties(path.join(server.path, "server.properties"));
        const permissionsPromise = permissionsFileToBPermissions(path.join(server.path, "permissions.json"));
        Promise.all([propertiesPromise, permissionsPromise]).then(([properties, permissions]) => {
            servers.push(new BServer(server.id, server.name, server.description, server.autostart, properties, permissions, [], server.version));
        });
    });
    Server.listen();
});




function addListeners() {
    Server.addListener("login", (socket, data) => {
        DatabaseConnection.query({
            // rowMode: 'array',
            text: 'SELECT * FROM users WHERE username=$1 AND password=$2',
            values: [data.username, data.password]
        }).then(result => {
            if(result.rows.length === 0) {
                socket.emit("loginResult", { success: false });
                return;
            }
            const data = result.rows[0];
            socket.emit("loginResult", {
                success: true,
                id: data.id,
                perm: data.perm,
                username: data.username,
                globalPermissions: data.globalpermissions,
            });
            Server.dataFromId.set(data.id, {
                socket: socket,
                username: data.username,
                globalPermissions: data.globalpermissions
            });
            Server.idFromSocket.set(socket, data.id);
        })
    });
    Server.addListener("getServers", async (socket, data) => {
        try {
            const proms = [];
            servers.forEach(server => {
                proms.push(server.createSmallVersion(socket));
            });
            Promise.all(proms).then((results) => {
                socket.emit("serverList", results);
            })

            // socket.emit("serverList", [
            //     await new BServer(1, "Test1", "testing server list number 1", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(2, "Test2", "testing server list number 2", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.15.0').createSmallVersion(socket),
            //     await new BServer(3, "Test3", "testing server list number 3", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(4, "Test4", "testing server list number 4", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(5, "Test5", "testing server list number 5", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(6, "Test6", "testing server list number 6", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(7, "Test7", "testing server list number 7", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(8, "Test8", "testing server list number 8", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(9, "Test9", "testing server list number 9", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(10, "Test10", "testing server list number 10", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(11, "Test11", "testing server list number 11", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(12, "Test12", "testing server list number 12", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(13, "Test13", "testing server list number 13", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            //     await new BServer(14, "Test14", "testing server list number 14", false, await propertiesFileToBProperties('test/sampleProperties.properties'), await permissionsFileToBPermissions('test/samplePermissions.json'), [], '1.16.0').createSmallVersion(socket),
            // ])
        }
        catch (err) {
            // if(err instanceof ServerNotFoundError) {
            //     console.log("Server was not found in database");
            // }
            // else {
            //     console.error(err);
            // }
            console.error(err); 
        }
    });
    // Server.addListener("")
}