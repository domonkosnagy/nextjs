import bcrypt from 'bcrypt';
import postgres from 'postgres';
import { invoices, customers, revenue, users } from '../lib/placeholder-data';

// Configuration parameters
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds between retries
const CHUNK_SIZE = 10; // Process users in chunks of 10

// Use non-pooling connection URL
const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL!;

// Configure PostgreSQL connection with enhanced settings
const sqlConfig = {
  ssl: {
    rejectUnauthorized: false, // Required for Supabase
    ca: process.env.DB_CA_CERT // Add if you have custom CA
  },
  max: 1,
  idle_timeout: 30,
  connect_timeout: 20,
  transform: {
    undefined: null
  },
  onnotice: (notice: any) => console.log('Postgres Notice:', notice),
  onclose: () => console.log('Connection closed'),
  onerror: (err: any) => console.error('Connection error:', err)
};

async function createConnection() {
  return postgres(connectionString, sqlConfig);
}

async function testConnection(sql: postgres.Sql) {
  try {
    const result = await sql`SELECT version()`;
    console.log('PostgreSQL version:', result[0].version);
    return true;
  } catch (error) {
    console.error('Connection test failed:', error);
    return false;
  }
}

async function seedUsers(sql: postgres.Sql) {
  try {
    // Process users in chunks to reduce connection load
    for (let i = 0; i < users.length; i += CHUNK_SIZE) {
      const chunk = users.slice(i, i + CHUNK_SIZE);
      
      await Promise.all(chunk.map(async (user) => {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        return sql`
          INSERT INTO users (id, name, email, password)
          VALUES (${user.id}, ${user.name}, ${user.email}, ${hashedPassword})
          ON CONFLICT (id) DO NOTHING;
        `;
      }));
    }
    
    console.log(`${users.length} users seeded successfully`);
  } catch (error) {
    console.error('Error seeding users:', error);
    throw error;
  }
}

// Similar implementations for seedCustomers, seedInvoices, seedRevenue
// (pass sql connection as parameter)

export async function GET() {
  let sql: postgres.Sql | null = null;
  let attempt = 1;
  
  while (attempt <= MAX_RETRIES) {
    try {
      console.log(`Connection attempt ${attempt}/${MAX_RETRIES}`);
      sql = await createConnection();
      
      // Test connection before proceeding
      if (!await testConnection(sql)) {
        throw new Error('Connection test failed');
      }
      
      // Ensure extensions exist
      await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
      
      // Create tables if not exists
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL
        );
      `;
      
      // Create other tables similarly...
      
      // Seed data
      await seedUsers(sql);
      // await seedCustomers(sql);
      // await seedInvoices(sql);
      // await seedRevenue(sql);
      
      return new Response(JSON.stringify({ 
        message: 'Database seeded successfully' 
      }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (attempt >= MAX_RETRIES) {
        return new Response(JSON.stringify({ 
          error: error instanceof Error ? error.message : 'Database seeding failed after retries'
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
      attempt++;
      
    } finally {
      if (sql) {
        try {
          await sql.end();
          console.log('Connection closed');
        } catch (e) {
          console.error('Error closing connection:', e);
        }
      }
    }
  }
  
  return new Response(JSON.stringify({ 
    error: 'Unexpected error in seeding process'
  }), { 
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  });
}