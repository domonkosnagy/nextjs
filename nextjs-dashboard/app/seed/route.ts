import bcrypt from 'bcrypt';
import postgres from 'postgres';
import { invoices, customers, revenue, users } from '../lib/placeholder-data';

// Configure PostgreSQL connection with explicit SSL and connection limits
const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: 'require',
  max: 1, // Use a single connection for seeding
  idle_timeout: 20, // Close idle connections quickly
  connect_timeout: 10, // Fail fast if connection can't be established
});

async function ensureExtensions() {
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  } catch (error) {
    console.warn('Extension creation notice:', error);
  }
}

async function seedTable<T>(
  tableName: string,
  createStatement: string,
  items: T[],
  transformFn?: (item: T) => Promise<any>
) {
  // Create table if not exists
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${tableName} ${createStatement}`);
  
  // Clear existing data (truncate is faster than delete)
  await sql.unsafe(`TRUNCATE TABLE ${tableName} CONTINUE IDENTITY CASCADE`);
  
  // Insert data with transformation if needed
  const insertPromises = items.map(async (item) => {
    const transformedItem = transformFn ? await transformFn(item) : item;
    return sql.unsafe(
      `INSERT INTO ${tableName} ${sql(transformedItem)} ON CONFLICT DO NOTHING`
    );
  });

  return Promise.all(insertPromises);
}

export async function GET() {
  try {
    // Verify connection first
    await sql`SELECT 1`;
    
    // Ensure extensions are available
    await ensureExtensions();

    // Seed all tables in a transaction
    const result = await sql.begin(async (sql) => {
      // Users with password hashing
      await seedTable('users', `
        (
          id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL
        )`, 
        users, 
        async (user) => ({
          ...user,
          password: await bcrypt.hash(user.password, 10)
        })
      );

      // Customers
      await seedTable('customers', `
        (
          id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          image_url VARCHAR(255) NOT NULL
        )`,
        customers
      );

      // Invoices
      await seedTable('invoices', `
        (
          id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
          customer_id UUID NOT NULL,
          amount INT NOT NULL,
          status VARCHAR(255) NOT NULL,
          date DATE NOT NULL
        )`,
        invoices
      );

      // Revenue
      await seedTable('revenue', `
        (
          month VARCHAR(4) NOT NULL UNIQUE,
          revenue INT NOT NULL
        )`,
        revenue
      );

      return { success: true };
    });

    return new Response(JSON.stringify({ message: 'Database seeded successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Seeding error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Database seeding failed' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    // Ensure connection is closed
    await sql.end();
  }
}