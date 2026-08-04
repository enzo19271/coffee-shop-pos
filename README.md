# ☕ Coffee Shop Online POS System

Sistem kasir online untuk coffee shop dengan dashboard untuk customer, staff, dan admin.

## 🎯 Fitur Utama

### Customer (Public)
- ✅ Browse menu dengan grid layout
- ✅ Tambah ke keranjang (LocalStorage)
- ✅ Checkout dengan form nama + nomor meja
- ✅ Pilih metode pembayaran (Cash/Transfer/QRIS)
- ✅ Upload bukti pembayaran
- ✅ Tracking order

### Staff (Login Required)
- ✅ Login dengan username/password
- ✅ Dashboard pesanan masuk
- ✅ Lihat detail order + bukti pembayaran
- ✅ Update status pesanan
- ✅ View penjualan hari ini
- ✅ Catat pengeluaran stok/peralatan

### Admin (Login Required)
- ✅ Dashboard analytics
- ✅ Menu management (add/edit/delete)
- ✅ View penjualan + profit
- ✅ Financial report
- ✅ Insights berbasis periode

## 🏗️ Arsitektur

```
Frontend (HTML/CSS/JS)
    ↓
Vercel Serverless Functions (API)
    ↓
GitHub Repository (Database)
```

### Data Structure
```
data/
├── menu/
│   └── items.json          # Menu items
├── orders/
│   └── orders-YYYY-MM.json # Monthly orders
├── staff/
│   └── users.json          # Staff accounts
├── analytics/
│   └── expenses.json       # Expense records
└── settings/
    └── config.json         # App config
```

## 🚀 Quick Start

### 1. Setup GitHub Repository

```bash
# Clone atau create repo baru di GitHub
git clone https://github.com/YOUR_USERNAME/coffee-shop-pos.git
cd coffee-shop-pos

# Extract files ke dalam folder
# Push ke GitHub
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Setup Vercel Project

1. Pergi ke https://vercel.com
2. Click "Add New..." → "Project"
3. Import repository GitHub Anda
4. Di "Environment Variables", tambahkan:

```
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx
GITHUB_OWNER=your_username
GITHUB_REPO=coffee-shop-pos
GITHUB_BRANCH=main
JWT_SECRET=your-super-secret-key-12345
```

**Cara generate GitHub Token:**
- Pergi ke https://github.com/settings/tokens
- Click "Generate new token"
- Pilih scope: `repo, workflow`
- Copy token

### 3. Deploy

```bash
# Vercel otomatis deploy saat push ke GitHub
# atau dari Vercel dashboard click "Deploy"
```

## 📝 Demo Credentials

**Staff Login:**
- Username: `staff`
- Password: `password`

**Admin Login:**
- Username: `admin`
- Password: `admin`

## 📋 API Endpoints

### Public
- `GET /api/menu/list` - Get all menu items
- `POST /api/orders/create` - Create new order

### Protected (Require JWT)
- `POST /api/auth/login` - Login staff/admin
- `GET /api/orders/pending` - Get pending orders
- `PATCH /api/orders/update-status` - Update order status
- `POST /api/analytics/add-expense` - Add expense
- `GET /api/analytics/summary` - Get analytics

## 🔐 Security

- JWT token dengan 24 jam expiry
- Password verifikasi di backend
- Base64 encoding untuk payment proof
- GitHub token disimpan di environment variable

## 📱 Pages

- `/` - Customer menu page
- `/staff-login.html` - Staff/Admin login
- `/staff.html` - Staff dashboard
- `/admin.html` - Admin dashboard

## 🔄 Workflow

### Customer Order Flow
1. Customer browse menu → Lihat grid menu
2. Select item & variant → Add to cart
3. Click cart badge → Open checkout
4. Isi nama + nomor meja
5. Pilih payment method
6. Upload bukti (jika transfer/QRIS)
7. Submit order → Tersimpan di GitHub
8. Order diterima staff untuk diproses

### Staff Workflow
1. Login dengan credential
2. Dashboard pesanan masuk
3. Verifikasi bukti pembayaran (jika ada)
4. Update status: pending → confirmed → completed
5. Catat expense untuk tracking saldo

### Admin Workflow
1. Login dengan credential admin
2. Lihat analytics dashboard
3. Manage menu items
4. View financial report
5. Monitor performa bisnis

## 🎨 Customization

### Ubah Menu
Edit `data/menu/items.json`:
```json
{
  "id": "coffee_001",
  "name": "Menu Name",
  "category": "Coffee",
  "price": 25000,
  "image": "☕",
  "variants": ["Small", "Large"],
  "available": true
}
```

### Ubah Staff Credentials
Edit `data/staff/users.json`:
```json
{
  "username": "newstaff",
  "passwordHash": "...",
  "role": "staff",
  "name": "Staff Name",
  "status": "active"
}
```

## 🐛 Troubleshooting

**Error: "GitHub API error 401"**
- Check GitHub token di vercel environment variable
- Pastikan token masih valid (belum expired)

**Error: "Invalid token"**
- Clear browser cache & localStorage
- Login ulang
- Check JWT_SECRET di environment variable

**Order tidak tersimpan**
- Check internet connection
- Verify GitHub repository accessible
- Check API logs di Vercel dashboard

## 📊 Next Steps (Phase 2)

- [ ] Real-time updates dengan WebSocket
- [ ] Vercel Blob untuk image storage
- [ ] Vercel Postgres untuk database
- [ ] Payment gateway integration
- [ ] Email notifications
- [ ] Mobile app
- [ ] Analytics charts
- [ ] User permission management

## 📞 Support

Untuk bantuan:
1. Check API logs di Vercel dashboard
2. Verify GitHub token & repository access
3. Check browser console untuk error messages

---

**Happy coding! ☕**
