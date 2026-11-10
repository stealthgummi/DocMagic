const { neon } = require('@neondatabase/serverless');

module.exports = () => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
  return neon(url);
};
