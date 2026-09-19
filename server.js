require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const upload = multer({ storage: multer.memoryStorage() });
const BUCKET = 'uploads';

function getExt(filename) {
    const i = filename.lastIndexOf('.');
    return i !== -1 ? filename.slice(i) : '';
}

// อัปโหลดไฟล์ขึ้น Supabase Storage แล้วคืน public URL
async function uploadToStorage(file, folder) {
    const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}${getExt(file.originalname)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: false
    });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return { url: data.publicUrl };
}

// ดึง path ของไฟล์ใน storage จาก public URL เพื่อใช้ลบไฟล์
function extractStoragePath(url) {
    if (!url || !url.includes(`/storage/v1/object/public/${BUCKET}/`)) return null;
    return url.split(`/storage/v1/object/public/${BUCKET}/`)[1];
}

// สมัครสมาชิก
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'กรุณากรอกข้อมูลให้ครบ' });

    const { data: existing } = await supabase
        .from('users')
        .select('id')
        .ilike('username', username)
        .maybeSingle();

    if (existing) return res.status(400).json({ message: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' });

    const { data, error } = await supabase
        .from('users')
        .insert({
            username: username.trim(),
            password: password.trim(),
            avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${username.trim()}`
        })
        .select()
        .single();

        if (error) return res.status(500).json({ message: 'สมัครสมาชิกไม่สำเร็จ' });
    data.user_id = data.id;
    res.json({ message: 'Success', user: data });
});

// เข้าสู่ระบบ
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    const { data, error } = await supabase
        .from('users')
        .select('*')
        .ilike('username', username)
        .eq('password', password)
        .maybeSingle();

        if (error || !data) return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    data.user_id = data.id;
    res.json({ message: 'Success', user: data });
});

// จำลอง Google Login
app.post('/api/google-login', async (req, res) => {
    const { name, picture } = req.body;
    const username = name || 'Google User';

    let { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .maybeSingle();

    if (!user) {
        const { data, error } = await supabase
            .from('users')
            .insert({
                username,
                password: 'google_user',
                avatar: picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`
            })
            .select()
            .single();
                if (error) return res.status(500).json({ message: 'เข้าสู่ระบบล้มเหลว' });
        user = data;
    }

    user.user_id = user.id;
    res.json({ message: 'Success', user });
});

// แก้ไขโปรไฟล์ (การเปลี่ยนชื่อในโพสต์/คอมเมนต์เก่าให้อัตโนมัติ ทำโดย TRIGGER ในฐานข้อมูล)
app.put('/api/profile', upload.single('avatar_file'), async (req, res) => {
    const { user_id, new_username, new_password } = req.body;

    const updates = {};
    if (new_username && new_username.trim() !== '') updates.username = new_username.trim();
    if (new_password && new_password.trim() !== '') updates.password = new_password.trim();

    if (req.file) {
        const { url } = await uploadToStorage(req.file, 'avatars');
        updates.avatar = url;
    }

    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', user_id)
        .select()
        .single();

        if (error) return res.status(500).json({ message: 'บันทึกข้อมูลล้มเหลว' });
    data.user_id = data.id;
    res.json({ message: 'Profile updated', user: data });
});

// ดึงภาพผลงานทั้งหมด (พร้อมคอมเมนต์)
app.get('/api/artworks', async (req, res) => {
    const { data, error } = await supabase
        .from('artworks')
        .select('*, comments(*)')
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ message: 'ดึงข้อมูลล้มเหลว' });

    data.forEach(a => {
        a.artwork_id = a.id;
        a.comments.sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
    });

    res.json(data);
});

// นับจำนวนคอมเมนต์ของโพสต์ (เรียกใช้ FUNCTION ในฐานข้อมูล)
app.get('/api/artworks/:id/comment-count', async (req, res) => {
    const { data, error } = await supabase.rpc('get_comment_count', { p_artwork_id: req.params.id });
    if (error) return res.status(500).json({ message: 'นับคอมเมนต์ล้มเหลว' });
    res.json({ count: data });
});

// โพสต์ผลงานใหม่
app.post('/api/artworks', upload.single('image_file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'กรุณาเลือกไฟล์ภาพ' });

    const { title, category, user_id, author, avatar } = req.body;

    try {
        const { url } = await uploadToStorage(req.file, 'artworks');

        const { data, error } = await supabase
            .from('artworks')
            .insert({
                title: title || 'Untitled',
                image_url: url,
                category: category || 'ทั่วไป',
                user_id,
                author: author || 'User',
                avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${author || 'user'}`
            })
            .select()
            .single();

        if (error) throw error;
        data.artwork_id = data.id;
        data.comments = [];
        res.json({ message: 'Success', artwork: data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'อัปโหลดล้มเหลว' });
    }
});

// ลบโพสต์ (เรียกใช้ PROCEDURE delete_artwork_proc ซึ่งเช็คสิทธิ์เจ้าของในฐานข้อมูลเอง)
app.delete('/api/artworks/:id', async (req, res) => {
    const artworkId = req.params.id;
    const requesterId = req.body.user_id;

    if (!requesterId) return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบโพสต์นี้' });

    const { data: artwork } = await supabase
        .from('artworks')
        .select('image_url')
        .eq('id', artworkId)
        .maybeSingle();

            const { error } = await supabase.rpc('delete_artwork_fn', {
        p_artwork_id: artworkId,
        p_user_id: requesterId
    });

    if (error) {
        console.error('DELETE ARTWORK ERROR:', error);
        return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบโพสต์นี้' });
    }

    if (artwork) {
        const path = extractStoragePath(artwork.image_url);
        if (path) await supabase.storage.from(BUCKET).remove([path]);
    }

    res.json({ message: 'Deleted successfully' });
});

// คอมเมนต์
app.post('/api/artworks/:id/comments', async (req, res) => {
    const artworkId = req.params.id;
    const { username, text, user_id } = req.body;

    const { data, error } = await supabase
        .from('comments')
        .insert({
            artwork_id: artworkId,
            user_id: user_id || null,
            username: username || 'User',
            text: text.trim()
        })
        .select()
        .single();

    if (error) return res.status(404).json({ message: 'ไม่พบรูปภาพนี้' });
    res.json({ message: 'Success', comment: data });
});

// ลบคอมเมนต์ (เรียกใช้ PROCEDURE delete_comment_proc)
app.delete('/api/artworks/:artId/comments/:commentId', async (req, res) => {
    const requesterId = req.body.user_id;
    if (!requesterId) return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบคอมเมนต์นี้' });

        const { error } = await supabase.rpc('delete_comment_fn', {
        p_comment_id: req.params.commentId,
        p_user_id: requesterId
    });

    if (error) return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ลบคอมเมนต์นี้' });
    res.json({ message: 'Comment deleted' });
});

app.listen(3000, () => {
    console.log('Server is running at http://localhost:3000');
});