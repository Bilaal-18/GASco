const cloudinary = require('../../config/cloudinary');

const uploadCtrl = {};

// Upload profile image to Cloudinary
uploadCtrl.uploadProfileImage = async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.files || !req.files.image) {
      console.log('No file in request:', req.files);
      return res.status(400).json({ error: 'No image file provided' });
    }

    const imageFile = req.files.image;
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(imageFile.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.' });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (imageFile.size > maxSize) {
      return res.status(400).json({ error: 'File size too large. Maximum size is 5MB.' });
    }

    // Get file data (express-fileupload uses in-memory mode by default)
    let fileData;
    if (imageFile.data) {
      // In-memory mode - data is a Buffer
      fileData = imageFile.data;
    } else if (imageFile.tempFilePath) {
      // Temp file mode - read the file
      const fs = require('fs');
      fileData = fs.readFileSync(imageFile.tempFilePath);
    } else {
      console.error('Invalid file data structure:', {
        hasData: !!imageFile.data,
        hasTempFilePath: !!imageFile.tempFilePath,
        mimetype: imageFile.mimetype,
        size: imageFile.size
      });
      return res.status(400).json({ error: 'Invalid file data. Please try again.' });
    }

    // Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'gasco/profiles',
          resource_type: 'image',
          transformation: [
            { width: 500, height: 500, crop: 'limit' },
            { quality: 'auto' },
            { format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );
      
      uploadStream.end(fileData);
    });

    res.status(200).json({
      message: 'Image uploaded successfully',
      imageUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id
    });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ 
      error: 'Failed to upload image',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Delete image from Cloudinary
uploadCtrl.deleteImage = async (req, res) => {
  try {
    const { publicId } = req.body;
    
    if (!publicId) {
      return res.status(400).json({ error: 'Public ID is required' });
    }

    const result = await cloudinary.uploader.destroy(publicId);
    
    if (result.result === 'ok') {
      res.status(200).json({ message: 'Image deleted successfully' });
    } else {
      res.status(404).json({ error: 'Image not found' });
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
};

module.exports = uploadCtrl;

