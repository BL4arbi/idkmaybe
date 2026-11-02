import pg from 'pg';
import 'dotenv/config';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Room for every user of the site acting at once (15 people, a few
  // queries each), well under Postgres' default limit of 100 connections.
  max: 20,
});
