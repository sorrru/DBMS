#!/usr/bin/env bash
set -euo pipefail

mongosh --host mongodb:27017 --quiet --eval '
try {
  const status = rs.status();
  if (status.ok === 1) quit(0);
} catch (error) {
  if (error.codeName !== "NotYetInitialized") throw error;
}
rs.initiate({
  _id: "rs0",
  members: [{ _id: 0, host: "localhost:27017" }]
});
'

