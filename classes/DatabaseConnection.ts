import { timeStamp } from "console";

const db = require('pg');

export default class DatabaseConnection {
    static numOfQuerys = 0;
    static connection: any;
    static connect(config) {
        if(this.connection) return;
        this.connection = new db.Client(config.db);
        this.connection.connect()
        .then(() => console.log("DB connected successfully"))
        .catch((err) => {
            console.log("DB connection error. Aborting. Error: " + err + " using config " + config.db);
            process.exit(1);
        });
    }
    static async query(object: any) {
        console.log("Database query " + ++DatabaseConnection.numOfQuerys);
        return await this.connection.query(object);
    }
}