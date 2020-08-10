import DatabaseConnection from './DatabaseConnection';
import { timeStamp } from 'console';
export class BWorld {
    id: number;
    serverId: number;
    name: string;
    description: string;
    path: string;

    constructor(id) {
        this.id = id;
        DatabaseConnection.query({
            // rowMode: 'array',
            text: 'SELECT * FROM worlds WHERE id=$1',
            values: [this.id]
        }).then(result => {
            this.serverId = result[0].serverId;
            this.name = result[0].name;
            this.description = result[0].description;
            this.path = result[0].path;
        });
    }
}