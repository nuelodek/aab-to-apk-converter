const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use('/download', express.static(path.join(__dirname, 'download')));

// Serve static files from uploads directory
app.use('/downloads', express.static('uploads'));

// Download route for APK files
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'uploads', filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

const debugKeystorePath = path.join(__dirname, 'debug.keystore');

if (!fs.existsSync(debugKeystorePath)) {
  console.log('🔧 Creating debug.keystore...');
  const keytoolCmd = process.platform === 'win32' ? 
    `"${process.env.JAVA_HOME || 'C:\\Program Files\\Java\\jdk-latest'}\\bin\\keytool"` : 
    'keytool';
    
  exec(`${keytoolCmd} -genkey -v -keystore ${debugKeystorePath} -storepass android -keypass android -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"`,
    (err, stdout, stderr) => {
      if (err) {
        console.error('❌ Failed to create debug.keystore:', stderr);
        console.error('Error details:', err);
        console.error('Command output:', stdout);
      } else {
        console.log('✅ debug.keystore created successfully');
        console.log('Keystore location:', debugKeystorePath);
      }
    });
}

const upload = multer({ dest: 'uploads/' });

app.post('/convert', upload.fields([
  { name: 'aab', maxCount: 1 },
  { name: 'keystore', maxCount: 1 }
]), async (req, res) => {
  console.log('📦 Starting AAB conversion process...');
  const id = uuidv4();
  console.log('🔑 Generated UUID:', id);
  
  const aabPath = req.files.aab[0].path;
  const outputApks = `uploads/${id}.apks`;
  const apkOutputDir = `uploads/${id}_apk`;
  console.log('📁 Input AAB path:', aabPath);
  console.log('📁 Output APKS path:', outputApks);
  console.log('📁 APK output directory:', apkOutputDir);
  
  fs.mkdirSync(apkOutputDir);
  console.log('✅ Created output directory');

  const mode = req.body.mode || 'debug';
  console.log('🔧 Converting in mode:', mode);
  let cmd;

  if (mode === 'debug') {
    console.log('🔑 Using debug keystore for signing');
    cmd = `java -jar "bundletool-all-1.18.1 (1).jar" build-apks --bundle=${aabPath} --output=${outputApks} --mode=universal ` +
          `--ks=debug.keystore --ks-key-alias=debug --ks-pass=pass:android --key-pass=pass:android`;
  } else {
    console.log('🔑 Using custom keystore for signing');
    const ksPath = req.files.keystore[0].path;
    const { alias, ks_pass, key_pass } = req.body;
    console.log('📁 Keystore path:', ksPath);
    console.log('🔑 Using keystore alias:', alias);
    cmd = `java -jar "bundletool-all-1.18.1 (1).jar" build-apks --bundle=${aabPath} --output=${outputApks} --mode=universal ` +
          `--ks=${ksPath} --ks-key-alias=${alias} --ks-pass=pass:${ks_pass} --key-pass=pass:${key_pass}`;
  }

  console.log('⚙️ Executing bundletool command...');
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('❌ Bundletool execution failed');
      console.error('Error details:', err);
      console.error('Command output (stdout):', stdout);
      console.error('Command output (stderr):', stderr);
      console.error('Command that failed:', cmd);
      return res.json({ message: '❌ Conversion failed. Check your inputs or keystore info.' });
    }
    console.log('✅ Bundletool command executed successfully');
    console.log('📦 Extracting APK from APKS bundle...');

    try {
      const zip = new AdmZip(outputApks);
      zip.extractAllTo(apkOutputDir, true);
      console.log('✅ APK extraction completed');
      
      const apkPath = `${apkOutputDir}/universal.apk`;
      console.log('🔍 Looking for universal.apk at:', apkPath);
      
      if (fs.existsSync(apkPath)) {
        const link = `/download/${apkPath}`;
        console.log('✅ Universal APK found, download link created:', link);
        res.json({ message: '✅ Conversion successful!', link });
      } else {
        console.error('❌ Universal APK not found in output directory');
        res.json({ message: '❌ APK not found in .apks bundle.' });
      }
    } catch (extractError) {
      console.error('❌ APK extraction failed');
      console.error('Error details:', extractError);
      return res.json({ message: '❌ Failed to extract APK.' });
    }
  });
});

app.get('/download/:file', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.file);
  console.log('📥 Serving download request for:', filePath);
  res.download(filePath);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log('📁 Working directory:', __dirname);
});
