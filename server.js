const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// สร้างโฟลเดอร์เก็บไฟล์อัปโหลดถ้ายังไม่มี
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ตั้งค่าที่เก็บไฟล์รูปภาพ
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

let users = [
    { id: 1, username: 'user1', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=user1' }
];

let artworks = [
    {
        artwork_id: 1,
        title: "Mountain Sky",
        image_url: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b",
        category: "ภาพถ่ายวิว",
        author: "artist_pro",
        avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=artist",
        comments: [
            { id: 1, username: "user1", text: "โทนภาพสวยมากครับ!" }
        ]
    }
];

// Google / Local Login
app.post('/api/google-login', (req, res) => {
    const { name, email, picture } = req.body;
    const username = name || (email ? email.split('@')[0] : 'User');
    let user = users.find(u => u.username === username);
    if (!user) {
        user = {
            id: Date.now(),
            username,
            avatar: picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`
        };
        users.push(user);
    }
    res.json({ message: 'Success', user });
});

app.post('/api/login', (req, res) => {
    const { username } = req.body;
    let user = users.find(u => u.username === username);
    if (!user) {
        user = {
            id: Date.now(),
            username,
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`
        };
        users.push(user);
    }
    res.json({ message: 'Success', user });
});

// ดึงภาพผลงานทั้งหมด
app.get('/api/artworks', (req, res) => {
    res.json(artworks);
});

/// อัปโหลดไฟล์รูปภาพจากเครื่อง
app.post('/api/artworks', (req, res) => {
    upload.single('image_file')(req, res, (err) => {
        if (err) {
            console.error('Upload Error:', err);
            return res.status(500).json({ message: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'ไม่พบไฟล์รูปภาพที่ส่งมา' });
        }

        const { title, category, author, avatar } = req.body;
        const image_url = `/uploads/${req.file.filename}`;
        const newArt = {
            artwork_id: Date.now(),
            title: title || "Untitled",
            image_url,
            category: category || "ทั่วไป",
            author: author || "Anonymous",
            avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${author}`,
            comments: []
        };

        artworks.unshift(newArt);
        res.json({ message: 'Success', artwork: newArt });
    });
});
// เพิ่มคอมเมนต์
app.post('/api/artworks/:id/comments', (req, res) => {
    const artworkId = parseInt(req.params.id);
    const { username, text } = req.body;
    const art = artworks.find(a => a.artwork_id === artworkId);
    if (art) {
        const newComment = { id: Date.now(), username, text };
        art.comments.push(newComment);
        return res.json({ message: 'Success', comment: newComment });
    }
    res.status(404).json({ message: 'Not found' });
});

app.listen(3000, () => {
    console.log('Server is running at http://localhost:3000');
});