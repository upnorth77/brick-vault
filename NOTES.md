# Brick Vault — Dev Notes

## Future Improvements

### Persistent Price History Storage
Currently, all data (inventory, price history, weekly snapshots) is stored in browser localStorage.
This is fragile — data can be lost if localStorage is cleared, the browser profile changes, or the user switches machines.

**Goal:** Find a more durable storage solution so price history is not easily lost.

Options to consider:
- Write data to a local JSON file on disk via the Flask server (auto-save on change)
- SQLite database managed by the Flask backend
- Periodic auto-export to a file in a user-configured folder
- Allow the app to load/save from a fixed file path on startup/shutdown
