export async function first(env, sql, params = []) {
  const statement = env.DB.prepare(sql).bind(...params);
  const result = await statement.first();
  return result || null;
}

export async function all(env, sql, params = []) {
  const statement = env.DB.prepare(sql).bind(...params);
  const result = await statement.all();
  return result?.results || [];
}

export async function run(env, sql, params = []) {
  const statement = env.DB.prepare(sql).bind(...params);
  return statement.run();
}
