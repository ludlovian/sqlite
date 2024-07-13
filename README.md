# sqlite
My standard use of SQLite

Uses `better-sqlite3` as a peer dependency

## Database
```
import Database from '@ludlovian/sqlite'

const db = new Database(file, options)
```

The default export. A class encapsulating the database.

Arguments:
- `file` - the filename, or `""` or `:memory:`
- `options` - the options, see below

### Options

On creation you can offer the following
- `createDDL` - DDL to be run if the file is being created.
- `runtimeDDL` - DDL to be run everytime you open it
- `checkSchema` - if given, this will check that `version` in `_schema` matches

Any DDL used is prettied before being run

---

### ._db

Gives you access to the underlying `better-sqlite3` database.

### ._inTransaction

Are we in a transaction (managed by us)

### .close

Closes the database.

### get(view|sql, params) => record

Selects the first row from the given view, or sql, after applying the
params

The sql can be given as an SQL string, or simply a view/table name which
will use the given params as WHERE conditions.

Returns an object, or null-ish

### all(view|sql, params) => [record]

Like `.get` but gets all the rows as an array.

### run(storedProc|sql, params)

Updates by calling a stored proc (inserting a row).

If SQL is given, rather than a view/table name, then it simply
executes it with the bound parameters given

### prepare(sql)

Prepares a statement.
Returns something you can call `.get`, `.all`. or `.run` on.

### exec(sql)

Calls a single arbitrary SQL statement. Bypasses any update or
autocommit processing.

### .autoCommit

Sets a regular bouncer period to auto-commit transactions.
Any `db.run` or `stmt.run` will start a transaction, which will commit `ms` milliseconds
later. Subsequent updates can be made, with the datbaase committing periodically.

### transaction(function)

Calls the specified function inside a sync transaction, coping with
rollbacks as needed.

### asyncTransaction(ms, function)

Calls the specified async function, committing regularly every `ms` milliseconds.

Any failure will only rollbaack to the last commit.

This is just a wrapper around setting `.autoCommit`

### notify(callback) => disposeFunction

Sets up notification - after every `db.run` or `stmt.run`

### trackChanges(table, { dest = 'changes', schema = 'temp' ))

Adds triggers to track inserts/changes/deletes to a table

These changes are added to the `dest` table, which should already exist

The triggers are created in the temp schema, unless you say otherwise

The changes table should be created with the following structure:
```sql
CREATE TABLE changes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,        -- table name
  type  INTEGER NOT NULL,     -- 0 = new insert values
                              -- 1 = pre-update values
                              -- 2 = post-update values
                              -- 3 = deleted values
  row   TEXT,                 -- JSON row,
  tm    REAL                  -- Julian date of update
)
```

### createProcedure(name, [args], sql)

Create a stored procedure (a view with a trigger).
Args must be given as an array, even if empty.
