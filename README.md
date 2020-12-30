# bedrock-server-manager
Manages bedrock servers from a web api using sockets

## Install

```sh
npm i
tsc
node index.js util hash <your chosen admin password>
```

Create db tables (mysql):

```sql
CREATE DATABASE bsm;
USE bsm;
CREATE USER 'bsm'@'localhost' IDENTIFIED WITH mysql_native_password BY '<yourpassword>';
GRANT ALL PRIVILEGES ON bsm.* TO 'bsm'@'localhost';
-- The following is no longer necessary-- will be done automatically
CREATE TABLE users (id int NOT NULL AUTO_INCREMENT, username varchar(20) NOT NULL, password char(32) NOT NULL, perm varchar(20), globalpermissions smallint, PRIMARY KEY(id));
CREATE TABLE players (username varchar(15), xuid varchar(20));
CREATE TABLE servers (id int NOT NULL AUTO_INCREMENT, path varchar(100), allowedusers JSON, description varchar(100), version varchar(15), autostart boolean, type varchar(15), PRIMARY KEY(id));
INSERT INTO users (username, password, perm, globalpermissions) VALUES ('admin', '<md5 hash of password acquired from script above>', 'Superadmin', 255);
```

Setup `config.json`:

```json
{
    "db": {
        "user": "bsm",
        "password": "<yourpassword>",
        "host": "localhost",
        "database": "bsm",
        "software": "mysql"
    },
    "basePath": "C:\\path\\to\\basePath",
    "bdsDownloads": "C:\\path\\to\\basePath\\bdsDownloads"
}
```

## Run

```sh
node index.js
```

