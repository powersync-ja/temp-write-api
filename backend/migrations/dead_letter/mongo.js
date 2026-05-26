// Run with: mongosh "$DATABASE_URI" mongo.js
db.createCollection('powersync_dead_letter');
db.powersync_dead_letter.createIndex({ created_at: -1 });
db.powersync_dead_letter.createIndex({ failed_table: 1 });
