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
- `checkSchema` - if given, this will check that `version` in `schema` matches

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

You can also call the `.pluck` attribute to make it pluck
the first column

### exec(sql)

Calls a single arbitrary SQL statement. Bypasses any update or
autocommit processing.

### .autoCommit

Sets a regular bouncer period to auto-commit transactions.
Any `db.run` or `stmt.run` will start a transaction, which will commit `ms` milliseconds
later. Subsequent updates can be made, with the datbaase committing periodically.

### .pluck => db

Turns the next .pluck => db

Turns the next `.get` or `.all` into a plucked query, returning just the
first column.

### transaction(function)

Calls the specified function inside a sync transaction, coping with
rollbacks as needed.

### asyncTransaction(ms, function)

Calls the specified async function, committing regularly every `ms` milliseconds.

Any failure will only rollbaack to the last commit.

This is just a wrapper around setting `.autoCommit`

### notify(callback) => disposeFunction

Sets up notification - after every `db.run` or `stmt.run`

### trackChanges(table, { type='json', dest='changes', exclude })

Adds triggers to track inserts/changes/deletes to a table

These changes are added to the `dest` table, which should already exist

There are two types: `json` and `sql`.

If type is `json` the changes table should have the following structure:
```sql
CREATE TABLE changes (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,        -- table name
  before TEXT,                 -- the before row data in JSON
  after  TEXT,                 -- the after row data in JSON
  tm     REAL                  -- Julian date of update
)
```

and for `sql` type it should be:
```sql
CREATE TABLE changes (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  sql    TEXT NOT NULL,        -- the sql statement
  tm     REAL                  -- Julian date of update
)
```
