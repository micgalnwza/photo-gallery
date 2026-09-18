const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

let users = [];
let artworks = [];

// สมัครสมาชิก
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบ' });

    const exists = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) return res.status(400).json({ message: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });

    const newUser = {
        user_id: 'usr_' + Date.now(),
        username: username.trim(),
        password: password.trim(),
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${username.trim()}`
    };
    users.push(newUser);
    res.json({ message: 'Success', user: newUser });
});

// เข้าสู่ระบบ
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
    if (!user) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

    res.json({ message: 'Success', user });
});

// จำลอง Google Login
app.post('/api/google-login', (req, res) => {
    const { name, picture } = req.body;
    const username = name || 'Google User';
    let user = users.find(u => u.username === username);
    if (!user) {
        user = {
            user_id: 'usr_' + Date.now(),
            username,
            password: 'google_user',
            avatar: picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`
        };
        users.push(user);
    }
    res.json({ message: 'Success', user });
});

// แก้ไขโปรไฟล์ (เปลี่ยนชื่อ, รหัสผ่าน, รูป Avatar)
app.put('/api/profile', upload.single('avatar_file'), (req, res) => {
    const { user_id, new_username, new_password } = req.body;
    
    let user = users.find(u => String(u.user_id) === String(user_id));
    if (!user) {
        // หากไม่เจอผู้ใช้ ให้สร้างหรือผูกบัญชีใหม่ทันทีเพื่อไม่ให้ค้าง
        user = {
            user_id: String(user_id),
            username: new_username || 'User',
            password: new_password || '123456',
            avatar: req.file ? `/uploads/${req.file.filename}` : `https://api.dicebear.com/7.x/bottts/svg?seed=${new_username || 'user'}`
        };
        users.push(user);
    } else {
        if (new_username && new_username.trim() !== '') {
            const oldName = user.username;
            user.username = new_username.trim();
            // อัปเดตชื่อในโพสต์และคอมเมนต์เก่าทั้งหมด
            artworks.forEach(art => {
                if (String(art.user_id) === String(user.user_id)) art.author = user.username;
                art.comments.forEach(c => {
                    if (c.username === oldName) c.username = user.username;
                });
            });
        }
        if (new_password && new_password.trim() !== '') {
            user.password = new_password.trim();
        }
        if (req.file) {
            user.avatar = `/uploads/${req.file.filename}`;
            artworks.forEach(art => {
                if (String(art.user_id) === String(user.user_id)) art.avatar = user.avatar;
            });
        }
    }

    res.json({ message: 'Profile updated', user });
});

// ดึงภาพผลงานทั้งหมด
app.get('/api/artworks', (req, res) => {
    res.json(artworks);
});

// โพสต์ผลงานใหม่
app.post('/api/artworks', upload.single('image_file'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'กรุณาเลือกไฟล์ภาพ' });

    const { title, category, user_id, author, avatar } = req.body;

    const newArt = {
        artwork_id: String(Date.now()),
        title: title || 'Untitled',
        image_url: `/uploads/${req.file.filename}`,
        category: category || 'ทั่วไป',
        user_id: String(user_id),
        author: author || 'User',
        avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${author || 'user'}`,
        comments: []
    };

    artworks.unshift(newArt);
    res.json({ message: 'Success', artwork: newArt });
});

// ลบรูปภาพ
app.delete('/api/artworks/:id', (req, res) => {
    const artworkId = String(req.params.id);
    const requesterId = req.body && req.body.user_id ? String(req.body.user_id) : (req.query.user_id ? String(req.query.user_id) : null);

    const index = artworks.findIndex(a => String(a.artwork_id) === artworkId);
    if (index === -1) {
        return res.status(404).json({ message: 'ไม่พบโพสต์นี้' });
    }

    const artwork = artworks[index];

    // อนุญาตให้ลบได้เฉพาะเจ้าของโพสต์เท่านั้น
    if (!requesterId || String(artwork.user_id) !== requesterId) {
        return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบโพสต์นี้' });
    }

    // ลบไฟล์รูปภาพออกจากเครื่องจริงด้วย
    if (artwork.image_url) {
        const filePath = path.join(__dirname, 'public', artwork.image_url);
        fs.unlink(filePath, (err) => {
            if (err && err.code !== 'ENOENT') {
                console.error('ลบไฟล์รูปภาพไม่สำเร็จ:', err);
            }
        });
    }

    artworks.splice(index, 1);
    res.json({ message: 'Deleted successfully' });
});

// คอมเมนต์ (ผูกชื่อ Username ถูกต้อง 100% ไม่ขึ้น undefined)
app.post('/api/artworks/:id/comments', (req, res) => {
    const artworkId = String(req.params.id);
    const { username, text, user_id } = req.body;

    const art = artworks.find(a => String(a.artwork_id) === artworkId);
    if (!art) return res.status(404).json({ message: 'ไม่พบรูปภาพนี้' });

    const newComment = {
        id: Date.now(),
        user_id: user_id ? String(user_id) : null,
        username: username || 'User',
        text: text.trim()
    };
    art.comments.push(newComment);
    res.json({ message: 'Success', comment: newComment });
});

// ลบคอมเมนต์ (เฉพาะเจ้าของคอมเมนต์เท่านั้น)
app.delete('/api/artworks/:artId/comments/:commentId', (req, res) => {
    const artworkId = String(req.params.artId);
    const commentId = String(req.params.commentId);
    const requesterId = req.body && req.body.user_id ? String(req.body.user_id) : (req.query.user_id ? String(req.query.user_id) : null);

    const art = artworks.find(a => String(a.artwork_id) === artworkId);
    if (!art) return res.status(404).json({ message: 'ไม่พบโพสต์นี้' });

    const commentIndex = art.comments.findIndex(c => String(c.id) === commentId);
    if (commentIndex === -1) return res.status(404).json({ message: 'ไม่พบคอมเมนต์นี้' });

    const comment = art.comments[commentIndex];
    if (!requesterId || String(comment.user_id) !== requesterId) {
        return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบคอมเมนต์นี้' });
    }

    art.comments.splice(commentIndex, 1);
    res.json({ message: 'Comment deleted' });
});

app.listen(3000, () => {
    console.log('Server is running at http://localhost:3000');
});