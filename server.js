const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { Base64 } = require('js-base64');
require("dotenv").config();
const cors = require('cors');

//port number
const port = 3000;
const app = express();

// --- Configuration ---
app.use(cors({
    origin: "*", 
    methods: ["GET", "POST", "DELETE", "PUT"],
}));

const URI = process.env.URI ; 

// Middleware
app.use(express.json());

// ------------------------------------------
// --- LOGGING MIDDLEWARE (Request Tracer) ---
// ------------------------------------------
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.path}`);
    next();
});

let client, db;

// Function to connect to MongoDB
async function connectToMongo() {
    console.log("[MONGO] Attempting to connect to MongoDB...");
    try {
        client = new MongoClient(URI);
        await client.connect();
        db = client.db("BaddiesBoutique"); 
        console.log("[MONGO] Successfully connected to MongoDB!");
    } catch (error) {
        console.error("[MONGO ERROR] MongoDB connection error:", error);
        throw error;
    }
}

/**
 * Basic Authentication Middleware 
 * This checks for the "Basic email:password" header.
 */
async function basicAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    console.log("[AUTH] Checking Basic Auth header...");

    // 1. Check for header presence and format
    if (!authHeader || !authHeader.startsWith("Basic ")) {
        console.warn("[AUTH FAIL] Missing or invalid Basic Authorization header.");
        // We return 401 here if auth fails!
        return res.status(401).json({ message: "Authorization required (Basic Authentication)" }); 
    }
    
    const base64Credentials = authHeader.split(" ")[1];
    if (!base64Credentials) {
        console.warn("[AUTH FAIL] Invalid Basic Authorization format.");
        return res.status(400).json({ message: "Invalid Basic Authorization format" });
    }
    
    try {
        const credentials = Base64.decode(base64Credentials).split(":");
        const email = credentials[0];
        // Ensure password handles potential trailing spaces from Base64 decode
        const password = credentials[1].trim(); 
        console.log(`[AUTH] Decoded credentials for email: ${email}`);

        const usersCollection = db.collection("Users");
        const user = await usersCollection.findOne({ email: email });

        if (!user) {
            console.warn(`[AUTH FAIL] User not found for email: ${email}`);
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const decodedStoredpassword = Base64.decode(user.password);
        if (decodedStoredpassword !== password) {
            console.warn(`[AUTH FAIL] password mismatch for user: ${email}`);
            return res.status(401).json({ message: "Invalid email or password" });
        }
        
        req.user = user;
        console.log(`[AUTH SUCCESS] User authenticated: ${user._id}`);
        next();
    } catch (error) {
        console.error("[AUTH ERROR] Authentication failed during processing:", error);
        return res.status(401).json({ message: "Authentication failed" });
    }
}


// ------------------------------------------
// --- PUBLIC ENDPOINTS (No Auth Required) ---
// ------------------------------------------

// Create a new user account (Sign up)
app.post("/users", async (req, res) => {
    console.log("[ROUTE] POST /users (Sign Up)");
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            console.warn("[POST /users] Missing email or password in request body.");
            return res.status(400).json({ message: "email and password are required" });
        }
        
        const usersCollection = db.collection("Users");
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
            console.warn(`[POST /users] User already exists: ${email}`);
            return res.status(409).json({ message: "User with this email already exists" });
        }
        
        const encodedpassword = Base64.encode(password);
        const newUser = {
            ...req.body,
            password: encodedpassword, 
            Gender: req.body.Gender || null, 
            UserNumber: req.body.UserNumber || null,
            createdAt: new Date(), 
            updatedAt: new Date()
        };
        
        const result = await usersCollection.insertOne(newUser);
        console.log(`[POST /users SUCCESS] New user created with ID: ${result.insertedId}`);
        
        // Return success, client will need to log in separately or use the credentials immediately
        res.status(201).json({
            message: "User created successfully",
            user: { email: newUser.email, _id: result.insertedId }
        });
    } catch (error) {
        console.error("[POST /users ERROR] Error creating user:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET All Dresses (Catalog)
app.get("/dresses", async (req, res) => {
    console.log("[ROUTE] GET /dresses (Catalog)");
    try {
        const dressesCollection = db.collection("Dresses");
        const dresses = await dressesCollection.find({}).toArray(); 
        console.log(`[GET /dresses SUCCESS] Retrieved ${dresses.length} dresses.`);
        res.status(200).json(dresses);
    } catch (error) {
        console.error("[GET /dresses ERROR] Error retrieving dresses:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET Single Dress by ID
app.get("/dresses/:id", async (req, res) => {
    const { id } = req.params;
    console.log(`[ROUTE] GET /dresses/${id} (Single Dress)`);
    try {
        const dressesCollection = db.collection("Dresses");

        if (!ObjectId.isValid(id)) {
            console.warn(`[GET /dresses/${id}] Invalid ObjectId format: ${id}`);
            return res.status(400).json({ message: "Invalid product ID format" });
        }
        
        const dress = await dressesCollection.findOne({ _id: new ObjectId(id) });
        if (!dress) {
            console.log(`[GET /dresses/${id}] Dress not found.`);
            return res.status(404).json({ message: "Dress not found" });
        }
        console.log(`[GET /dresses/${id} SUCCESS] Dress found.`);
        res.status(200).json(dress);
    } catch (error) {
        console.error(`[GET /dresses/${id} ERROR] Error retrieving dress:`, error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// ----------------------------------------------------
// --- AUTHENTICATED ENDPOINTS (Require basicAuth) ---
// ----------------------------------------------------

// Apply basicAuth to all routes defined after this line
app.use(basicAuth); 

// User Login / password Check (Validation Route)
app.post("/checkpassword", async (req, res) => {
    // This route is now used by the frontend to confirm a successful login/token validity.
    console.log(`[ROUTE] POST /checkpassword (Login Check) for user: ${req.user.email}`);
    res.status(200).json({ 
        message: "Login successful",
        user: { 
            _id: req.user._id, 
            email: req.user.email 
        } 
    });
});

// --- CART ENDPOINTS (The fix for the original error!) ---

// POST - Add item to authenticated user's cart
app.post("/carts", async (req, res) => {
    const { productId, size, quantity } = req.body;
    // 🔑 Use the authenticated user's ID from the middleware
    const userId = req.user._id; 
    
    console.log(`[ROUTE] POST /carts for user: ${req.user.email}. Product: ${productId}`);
    try {
        const cartsCollection = db.collection("Carts");
        
        if (!productId || !size || !quantity || quantity < 1) {
             console.warn("[POST /carts] Invalid/missing data in request body.");
             return res.status(400).json({ error: "Missing productId, size, or invalid quantity." });
        }
        if (!ObjectId.isValid(productId)) {
             console.warn(`[POST /carts] Invalid productId format: ${productId}`);
             return res.status(400).json({ message: "Invalid productId format" });
        }

        const productObjectId = new ObjectId(productId);

        // Check if item (product+size) already exists for this user
        const existingItem = await cartsCollection.findOne({ 
             userId: userId, 
             productId: productObjectId, 
             size 
        });

        if (existingItem) {
            // Item exists, increment quantity
            await cartsCollection.updateOne(
                { _id: existingItem._id },
                { $inc: { quantity: quantity } }
            );
            console.log(`[POST /carts SUCCESS] Updated quantity for cart item ID: ${existingItem._id}`);
            res.status(200).json({ message: "Item quantity updated in cart" });
        } else {
            // Item does not exist, insert new item
            const newItem = {
                userId: userId,
                productId: productObjectId,
                size,
                quantity,
                addedAt: new Date()
            };
            const result = await cartsCollection.insertOne(newItem);
            console.log(`[POST /carts SUCCESS] Added new cart item ID: ${result.insertedId}`);
            res.status(201).json({ message: "Item added to cart", cartItemId: result.insertedId });
        }
    } catch (error) {
        console.error("[POST /carts ERROR] Error adding to cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET - Fetch all cart items for the authenticated user
app.get("/carts", async (req, res) => {
    console.log(`[ROUTE] GET /carts for user: ${req.user.email}`);
    try {
        const cartsCollection = db.collection("Carts");
        const userId = req.user._id;

        const cartItems = await cartsCollection.find({ userId }).toArray();
        console.log(`[GET /carts SUCCESS] Retrieved ${cartItems.length} cart items.`);
        
        res.status(200).json(cartItems);
    } catch (error) {
        console.error("[GET /carts ERROR] Error retrieving cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// DELETE - Remove item from user's cart by cart item ID
app.delete("/carts/:id", async (req, res) => {
    const { id } = req.params;
    console.log(`[ROUTE] DELETE /carts/${id} for user: ${req.user.email}`);
    try {
        const cartsCollection = db.collection("Carts");
        const userId = req.user._id;
        
        if (!ObjectId.isValid(id)) {
            console.warn(`[DELETE /carts/${id}] Invalid Cart Item ID format: ${id}`);
            return res.status(400).json({ message: "Invalid Cart Item ID format" });
        }

        const result = await cartsCollection.deleteOne({ 
            _id: new ObjectId(id), 
            userId: userId // Ensure the authenticated user "owns" the cart item
        });
        
        if (result.deletedCount === 0) {
            console.warn(`[DELETE /carts/${id}] Cart item not found or unauthorized.`);
            return res.status(404).json({ message: "Cart item not found or does not belong to user" });
        }
        
        console.log(`[DELETE /carts/${id} SUCCESS] Item removed from cart.`);
        res.status(200).json({ message: "Item removed from cart" });
    } catch (error) {
        console.error(`[DELETE /carts/${id} ERROR] Error removing item from cart:`, error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// --- USER PROFILE ENDPOINTS (Collection: Users) ---

// Get User Profile
app.get("/users/profile", async (req, res) => {
    console.log(`[ROUTE] GET /users/profile for user: ${req.user.email}`);
    try {
        const user = req.user;
        const userProfile = {
            nameAndSurname: user.nameAndSurname,
            email: user.email,
            Gender: user.Gender,
            UserNumber: user.UserNumber,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
        console.log(`[GET /users/profile SUCCESS] Profile retrieved.`);
        res.status(200).json(userProfile);
    } catch (error) {
        console.error("[GET /users/profile ERROR] Error fetching user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Update User Profile
app.put("/users/profile", async (req, res) => {
    console.log(`[ROUTE] PUT /users/profile for user: ${req.user.email}`);
    try {
        const { nameAndSurname, email, Gender, UserNumber } = req.body;
        const { _id } = req.user; 
        const usersCollection = db.collection("Users");
        
        const updateDoc = {
            $set: {
                nameAndSurname,
                email,
                Gender: Gender || null,
                UserNumber: UserNumber || null,
                updatedAt: new Date(),
            },
        };
        
        const result = await usersCollection.updateOne({ _id: new ObjectId(_id) }, updateDoc);
        if (result.matchedCount === 0) {
            console.warn(`[PUT /users/profile] User ID ${_id} not found for update.`);
            return res.status(404).json({ message: "User not found" });
        }
        
        const updatedUser = await usersCollection.findOne({ _id: new ObjectId(_id) });
        
        console.log(`[PUT /users/profile SUCCESS] Profile updated for ID: ${_id}`);
        const userProfile = {
            nameAndSurname: updatedUser.nameAndSurname,
            email: updatedUser.email,
            Gender: updatedUser.Gender,
            UserNumber: updatedUser.UserNumber,
            createdAt: updatedUser.createdAt,
            updatedAt: updatedUser.updatedAt,
        };
        res.status(200).json({ message: "Profile updated successfully", userProfile });
    } catch (error) {
        console.error("[PUT /users/profile ERROR] Error updating user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// --- WISHLIST ENDPOINTS (Collection: Wishlist) ---

// POST - Add product to user's wishlist
app.post("/wishlist", async (req, res) => {
    const { productId } = req.body;
    console.log(`[ROUTE] POST /wishlist for user: ${req.user.email}. Product: ${productId}`);
    try {
        const wishlistCollection = db.collection("Wishlist");
        const userId = req.user._id;
        
        if (!productId) {
             console.warn("[POST /wishlist] Missing productId.");
             return res.status(400).json({ error: "Missing productId." });
        }
        if (!ObjectId.isValid(productId)) {
             console.warn(`[POST /wishlist] Invalid productId format: ${productId}`);
             return res.status(400).json({ message: "Invalid productId format" });
        }

        const productObjectId = new ObjectId(productId);

        const existingItem = await wishlistCollection.findOne({ 
             userId, 
             productId: productObjectId 
        });

        if (existingItem) {
            console.warn(`[POST /wishlist] Item already exists for product: ${productId}`);
            return res.status(409).json({ message: "Item already in wishlist" });
        } 
        
        const newItem = {
            userId,
            productId: productObjectId,
            addedAt: new Date()
        };
        const result = await wishlistCollection.insertOne(newItem);
        console.log(`[POST /wishlist SUCCESS] Added new wishlist item ID: ${result.insertedId}`);
        res.status(201).json({ message: "Item added to wishlist", wishlistId: result.insertedId });
        
    } catch (error) {
        console.error("[POST /wishlist ERROR] Error adding to wishlist:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET - Fetch user's wishlist
app.get("/wishlist", async (req, res) => {
    console.log(`[ROUTE] GET /wishlist for user: ${req.user.email}`);
    try {
        const wishlistCollection = db.collection("Wishlist");
        const userId = req.user._id;

        const wishlistItems = await wishlistCollection.find({ userId }).toArray();
        console.log(`[GET /wishlist SUCCESS] Retrieved ${wishlistItems.length} wishlist items.`);
        
        res.status(200).json(wishlistItems);
    } catch (error) {
        console.error("[GET /wishlist ERROR] Error retrieving wishlist:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// DELETE - Remove item from user's wishlist by product ID
app.delete("/wishlist/:productId", async (req, res) => {
    const { productId } = req.params;
    console.log(`[ROUTE] DELETE /wishlist/${productId} for user: ${req.user.email}`);
    try {
        const wishlistCollection = db.collection("Wishlist");
        const userId = req.user._id;
        
        if (!ObjectId.isValid(productId)) {
            console.warn(`[DELETE /wishlist] Invalid productId format: ${productId}`);
            return res.status(400).json({ message: "Invalid Product ID format" });
        }
        
        const productObjectId = new ObjectId(productId);

        const result = await wishlistCollection.deleteOne({ 
            userId, 
            productId: productObjectId 
        });
        
        if (result.deletedCount === 0) {
            console.warn(`[DELETE /wishlist] Item not found or unauthorized for product: ${productId}`);
            return res.status(404).json({ message: "Item not found in wishlist or does not belong to user" });
        }
        
        console.log(`[DELETE /wishlist SUCCESS] Item removed from wishlist: ${productId}`);
        res.status(200).json({ message: "Item removed from wishlist" });
    } catch (error) {
        console.error("[DELETE /wishlist ERROR] Error removing item from wishlist:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- ORDERS ENDPOINTS (Collection: Orders) ---

// POST - Create a new order (usually after checkout)
app.post("/orders", async (req, res) => {
    console.log(`[ROUTE] POST /orders for user: ${req.user.email}`);
    try {
        const ordersCollection = db.collection("Orders");
        const userId = req.user._id;
        
        const orderData = req.body; 
        
        if (!orderData || !orderData.products || orderData.products.length === 0) {
            console.warn("[POST /orders] Order data is incomplete or empty.");
             return res.status(400).json({ message: "Order data is incomplete or empty." });
        }
        
        const newOrder = {
            ...orderData,
            userId,
            orderDate: new Date(),
            status: "Processing" 
        };

        const result = await ordersCollection.insertOne(newOrder);
        
        console.log(`[POST /orders SUCCESS] Order placed with ID: ${result.insertedId}`);

        res.status(201).json({ 
            message: "Order placed successfully!", 
            orderId: result.insertedId 
        });
    } catch (error) {
        console.error("[POST /orders ERROR] Error placing order:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

// GET - Fetch all orders for the authenticated user
app.get("/orders", async (req, res) => {
    console.log(`[ROUTE] GET /orders for user: ${req.user.email}`);
    try {
        const ordersCollection = db.collection("Orders");
        const userId = req.user._id;
        
        const orders = await ordersCollection.find({ userId }).toArray();
        console.log(`[GET /orders SUCCESS] Retrieved ${orders.length} orders.`);
        res.status(200).json(orders);
    } catch (error) {
        console.error("[GET /orders ERROR] Error fetching orders:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// Start the server and connect to MongoDB
async function startServer() {
    try {
        await connectToMongo();
        app.listen(port, () => {
            console.log(`[SERVER] Server listening at http://localhost:${port}`);
        });
    } catch (err) {
        console.error("[SERVER ERROR] Failed to connect to MongoDB or start server:", err);
        process.exit(1);
    }
}

startServer();