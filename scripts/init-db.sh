#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres -v app_user="$DB_USER" -v password="$DB_PASSWORD" -v app_database="$DB_NAME" -v test_database="${DB_NAME}_test" <<'SQL'
CREATE ROLE :"app_user" WITH LOGIN PASSWORD :'password';
CREATE DATABASE :"app_database" OWNER :"app_user";
CREATE DATABASE :"test_database" OWNER :"app_user";
SQL
