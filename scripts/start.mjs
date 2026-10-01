if (process.platform === 'win32') await import('../launcher.mjs');
else if (process.platform === 'linux') await import('../launcher-linux.mjs');
else { console.error('Supported platforms: Windows and Linux'); process.exitCode = 1; }
