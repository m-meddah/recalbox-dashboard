#!/usr/bin/env node

const path = require('node:path')
const Database = require('better-sqlite3')
const { drizzle } = require('drizzle-orm/better-sqlite3')
const { migrate } = require('drizzle-orm/better-sqlite3/migrator')

const dbPath = process.env.DATABASE_PATH || '/data/recalbox.db'
const migrationsFolder = path.join(__dirname, 'drizzle', 'migrations')

console.log(`Migrating database at ${dbPath}...`)

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

const db = drizzle(sqlite)
migrate(db, { migrationsFolder })
sqlite.close()

console.log('Migrations complete.')
