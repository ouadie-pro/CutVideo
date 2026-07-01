const fs = require('fs');
const path = require('path');

async function cleanupFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  } catch (error) {
    console.error(`Cleanup error for ${path.basename(filePath)}:`, error.message);
  }
}

async function cleanupDirectory(dirPath) {
  if (!dirPath) return;
  try {
    if (fs.existsSync(dirPath)) {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile()) {
          await cleanupFile(fullPath);
        } else if (entry.isDirectory()) {
          await cleanupDirectory(fullPath);
        }
      }
      await fs.promises.rmdir(dirPath);
    }
  } catch (error) {
    console.error(`Cleanup error for directory:`, error.message);
  }
}

module.exports = { cleanupFile, cleanupDirectory };
