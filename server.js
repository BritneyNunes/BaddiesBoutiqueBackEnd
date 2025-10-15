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
    origin: "*", // Allow all origins for development/testing
    methods: ["GET", "POST", "DELETE", "PUT"],
}));

// Load the MongoDB URI from environment variables
const URI = process.env.URI;

// Middleware
app.use(express.json());

let client, db;

// Function to connect to MongoDB
async function connectToMongo() {
    console.log("Attempting to connect to MongoDB...");
    try {
        client = new MongoClient(URI);
        await client.connect();
        // Ensure the database name matches your MongoDB setup
        db = client.db("BaddiesBoutique"); 
        console.log("Successfully connected to MongoDB!");
    } catch (error) {
        console.error("MongoDB connection error:", error);
        throw error;
    }
}

// Middleware for basic authentication
// Attaches the user object to req.user for use in subsequent middleware/routes
async function basicAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Basic ")) {
        return res.status(401).json({ message: "Authorization header missing or invalid" });
    }
    const base64Credentials = authHeader.split(" ")[1];
    if (!base64Credentials) {
        return res.status(400).json({ message: "Invalid Basic Authorization format" });
    }
    
    try {
        const credentials = Base64.decode(base64Credentials).split(":");
        const email = credentials[0];
        // The password must be trimmed to remove any trailing whitespace
        const password = credentials[1].trim(); 

        const usersCollection = db.collection("Users");
        const user = await usersCollection.findOne({ Email: email });

        // Decode the stored password for comparison
        // NOTE: Using Base64 encoding for passwords is not secure. Use bcrypt in a real application.
        if (!user || Base64.decode(user.Password) !== password) {
            return res.status(401).json({ message: "Invalid email or password" });
        }
        
        req.user = user; // Attach user object (including _id) to the request
        next();
    } catch (error) {
        console.error("Authentication error:", error);
        return res.status(401).json({ message: "Authentication failed" });
    }
}


// ------------------------------------------
// --- PUBLIC ENDPOINTS (No Auth Required) ---
// These routes are defined BEFORE app.use(basicAuth)
// ------------------------------------------

// Create a new user account (Sign up)
app.post("/users", async (req, res) => {
    try {
        const { NameAndSurname, Email, Password, Gender, UserNumber } = req.body; // Adjusted to expect raw body
        if (!Email || !Password) {
            return res.status(400).json({ message: "Email and password are required" });
        }
        
        const usersCollection = db.collection("Users");
        const existingUser = await usersCollection.findOne({ Email });
        if (existingUser) {
            return res.status(409).json({ message: "User with this email already exists" });
        }
        
        const encodedPassword = Base64.encode(Password);
        const newUser = {
            NameAndSurname, 
            Email,
            Password: encodedPassword, 
            Gender, 
            UserNumber,
            createdAt: new Date(), 
            updatedAt: new Date()
        };
        
        const result = await usersCollection.insertOne(newUser);
        res.status(201).json({
            message: "User created successfully",
            user: { Email: newUser.Email, _id: result.insertedId }
        });
    } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET All Dresses (Catalog)
// This is the endpoint the React frontend is calling.
app.get("/dresses", async (req, res) => {
    try {
        const dressesCollection = db.collection("Dresses");
        const dresses = await dressesCollection.find({}).toArray();
        res.status(200).json(dresses);
    } catch (error) {
        console.error("Error retrieving dresses:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET Single Dress by ID
app.get("/dresses/:id", async (req, res) => {
    try {
        const dressesCollection = db.collection("Dresses");
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid product ID format" });
        }
        
        const dress = await dressesCollection.findOne({ _id: new ObjectId(id) });
        if (!dress) {
            return res.status(404).json({ message: "Dress not found" });
        }
        res.status(200).json(dress);
    } catch (error) {
        console.error("Error retrieving dress:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// ----------------------------------------------------
// --- AUTHENTICATED ENDPOINTS (Require basicAuth) ---
// All routes after this line require a Basic Authorization header
// ----------------------------------------------------

// Apply basicAuth to all routes defined after this line
app.use(basicAuth); 

// User Login / Password Check (Used for successful login confirmation)
app.get("/checkpassword", async (req, res) => {
    // If we reach here, basicAuth succeeded.
    res.status(200).json({ 
        message: "Login successful",
        user: { 
            _id: req.user._id, 
            Email: req.user.Email 
        } 
    });
});

// --- USER PROFILE ENDPOINTS (Collection: Users) ---

// Get User Profile
app.get("/users/profile", async (req, res) => {
    try {
        const user = req.user;
        const userProfile = {
            NameAndSurname: user.NameAndSurname,
            Email: user.Email,
            Gender: user.Gender,
            UserNumber: user.UserNumber,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
        res.status(200).json(userProfile);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Update User Profile
app.put("/users/profile", async (req, res) => {
    try {
        const { NameAndSurname, Email, Gender, UserNumber } = req.body;
        const { _id } = req.user;
        const usersCollection = db.collection("Users");
        
        const updateDoc = {
            $set: {
                NameAndSurname,
                Email,
                Gender,
                UserNumber,
                updatedAt: new Date(),
            },
        };
        
        const result = await usersCollection.updateOne({ _id: new ObjectId(_id) }, updateDoc);
        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        
        // Fetch and return the updated profile
        const updatedUser = await usersCollection.findOne({ _id: new ObjectId(_id) });
        const userProfile = {
            NameAndSurname: updatedUser.NameAndSurname,
            Email: updatedUser.Email,
            Gender: updatedUser.Gender,
            UserNumber: updatedUser.UserNumber,
            createdAt: updatedUser.createdAt,
            updatedAt: updatedUser.updatedAt,
        };
        res.status(200).json({ message: "Profile updated successfully", userProfile });
    } catch (error) {
        console.error("Error updating user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- CART ENDPOINTS (Collection: Carts) ---

// POST - Add item to user's cart
app.post("/carts", async (req, res) => {
    try {
        const cartsCollection = db.collection("Carts");
        const userId = req.user._id;
        const { productId, size, quantity } = req.body;
        
        if (!productId || !size || !quantity || quantity < 1) {
             return res.status(400).json({ error: "Missing productId, size, or invalid quantity." });
        }
        if (!ObjectId.isValid(productId)) {
             return res.status(400).json({ message: "Invalid productId format" });
        }

        const productObjectId = new ObjectId(productId);

        // Check if item (product + size) already exists in the user's cart
        const existingItem = await cartsCollection.findOne({ 
            userId, 
            productId: productObjectId, 
            size 
        });

        if (existingItem) {
            // If exists, update quantity
            await cartsCollection.updateOne(
                { _id: existingItem._id },
                { $inc: { quantity: quantity } } // Increment quantity
            );
            res.status(200).json({ message: "Item quantity updated in cart" });
        } else {
            // If new, insert the item
            const newItem = {
                userId,
                productId: productObjectId,
                size,
                quantity,
                addedAt: new Date()
            };
            const result = await cartsCollection.insertOne(newItem);
            res.status(201).json({ message: "Item added to cart", cartItemId: result.insertedId });
        }
    } catch (error) {
        console.error("Error adding to cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET - Fetch all cart items for the authenticated user
app.get("/carts", async (req, res) => {
    try {
        const cartsCollection = db.collection("Carts");
        const userId = req.user._id;

        // Find all cart items belonging to the current user
        const cartItems = await cartsCollection.find({ userId }).toArray();
        
        res.status(200).json(cartItems);
    } catch (error) {
        console.error("Error retrieving cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// DELETE - Remove item from user's cart by cart item ID or product ID (using cart item ID is more robust)
app.delete("/carts/:id", async (req, res) => {
    try {
        const cartsCollection = db.collection("Carts");
        const userId = req.user._id;
        const { id } = req.params; // This ID should be the Carts document _id
        
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid Cart Item ID format" });
        }

        // Delete the item, ensuring it belongs to the current user
        const result = await cartsCollection.deleteOne({ 
            _id: new ObjectId(id), 
            userId 
        });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Cart item not found or does not belong to user" });
        }
        
        res.status(200).json({ message: "Item removed from cart" });
    } catch (error) {
        console.error("Error removing item from cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- WISHLIST ENDPOINTS (Collection: Wishlist) ---

// POST - Add item to user's wishlist
app.post("/wishlist", async (req, res) => {
    try {
        const wishlistCollection = db.collection("Wishlist");
        const userId = req.user._id;
        const { productId } = req.body;
        
        if (!productId) {
             return res.status(400).json({ error: "Missing productId." });
        }
        if (!ObjectId.isValid(productId)) {
             return res.status(400).json({ message: "Invalid productId format" });
        }

        const productObjectId = new ObjectId(productId);

        // Check if item already exists in the user's wishlist
        const existingItem = await wishlistCollection.findOne({ 
            userId, 
            productId: productObjectId 
        });

        if (existingItem) {
            return res.status(409).json({ message: "Item already in wishlist" });
        } 
        
        // Insert the new item
        const newItem = {
            userId,
            productId: productObjectId,
            addedAt: new Date()
        };
        const result = await wishlistCollection.insertOne(newItem);
        res.status(201).json({ message: "Item added to wishlist", wishlistId: result.insertedId });
        
    } catch (error) {
        console.error("Error adding to wishlist:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET - Fetch user's wishlist
app.get("/wishlist", async (req, res) => {
    try {
        const wishlistCollection = db.collection("Wishlist");
        const userId = req.user._id;

        // Find all wishlist items belonging to the current user
        const wishlistItems = await wishlistCollection.find({ userId }).toArray();
        
        res.status(200).json(wishlistItems);
    } catch (error) {
        console.error("Error retrieving wishlist:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// DELETE - Remove item from user's wishlist by product ID
app.delete("/wishlist/:productId", async (req, res) => {
    try {
        const wishlistCollection = db.collection("Wishlist");
        const userId = req.user._id;
        const { productId } = req.params;
        
        if (!ObjectId.isValid(productId)) {
            return res.status(400).json({ message: "Invalid Product ID format" });
        }
        
        const productObjectId = new ObjectId(productId);

        // Delete the item, ensuring it belongs to the current user
        const result = await wishlistCollection.deleteOne({ 
            userId, 
            productId: productObjectId 
        });
        
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Item not found in wishlist or does not belong to user" });
        }
        
        res.status(200).json({ message: "Item removed from wishlist" });
    } catch (error) {
        console.error("Error removing item from wishlist:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- ORDERS ENDPOINTS (Collection: Orders) ---

// POST - Create a new order with all cart items
app.post("/orders", async (req, res) => {
    try {
        const ordersCollection = db.collection("Orders");
        const userId = req.user._id;
        
        // Assuming req.body contains the order details (e.g., shipping, payment, a snapshot of products)
        const orderData = req.body; 
        
        if (!orderData || !orderData.products || orderData.products.length === 0) {
             return res.status(400).json({ message: "Order data is incomplete or empty." });
        }
        
        const newOrder = {
            ...orderData,
            userId,
            orderDate: new Date(),
            status: "Processing" // Default status
        };

        const result = await ordersCollection.insertOne(newOrder);
        
        // Optional: Clear the user's cart after a successful order is placed
        // await db.collection("Carts").deleteMany({ userId });

        res.status(201).json({ 
            message: "Order placed successfully!", 
            orderId: result.insertedId 
        });
    } catch (error) {
        console.error("Error placing order:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

// GET - Fetch all orders for the authenticated user
app.get("/orders", async (req, res) => {
    try {
        const ordersCollection = db.collection("Orders");
        const userId = req.user._id;
        
        // Find orders only for the authenticated user
        const orders = await ordersCollection.find({ userId }).toArray();
        res.status(200).json(orders);
    } catch (error) {
        console.error("Error fetching orders:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// Start the server and connect to MongoDB
async function startServer() {
    try {
        await connectToMongo();
        app.listen(port, "0.0.0.0", () => {
            console.log(`Server listening at http://localhost:${port}`);
        });
    } catch (err) {
        console.error("Failed to connect to MongoDB or start server:", err);
        process.exit(1);
    }
}

startServer();
