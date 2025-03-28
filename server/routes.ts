import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { z } from "zod";
import { 
  insertCartItemSchema,
  insertOrderItemSchema,
  insertOrderSchema,
  insertReviewSchema,
  insertUserSchema,
  insertProductSchema
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication routes
  setupAuth(app);

  // Categories routes
  app.get("/api/categories", async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  // Products routes
  app.get("/api/products", async (req, res) => {
    try {
      const { limit, category } = req.query;
      const options: { limit?: number, category?: string } = {};
      
      if (limit) options.limit = parseInt(limit as string);
      if (category) options.category = category as string;
      
      const products = await storage.getProducts(options);
      res.json(products);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);
      
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      res.json(product);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.get("/api/products/category/:category", async (req, res) => {
    try {
      const category = req.params.category;
      const products = await storage.getProductsByCategory(category);
      res.json(products);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  // Banners routes
  app.get("/api/banners", async (req, res) => {
    try {
      const banners = await storage.getBanners();
      res.json(banners);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  // Cart routes
  app.get("/api/cart", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const userId = req.user.id;
      let cart = await storage.getCart(userId);
      
      // Create a new cart if user doesn't have one
      if (!cart) {
        cart = await storage.createCart({ userId });
      }
      
      const cartWithItems = await storage.getCartWithItems(userId);
      res.json(cartWithItems);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.post("/api/cart/items", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const userId = req.user.id;
      let cart = await storage.getCart(userId);
      
      // Create a new cart if user doesn't have one
      if (!cart) {
        cart = await storage.createCart({ userId });
      }
      
      const cartItemData = insertCartItemSchema.parse({
        ...req.body,
        cartId: cart.id
      });
      
      const cartItem = await storage.addItemToCart(cartItemData);
      res.status(201).json(cartItem);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.put("/api/cart/items/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const id = parseInt(req.params.id);
      const { quantity } = z.object({ quantity: z.number().min(1) }).parse(req.body);
      
      const updatedItem = await storage.updateCartItem(id, quantity);
      
      if (!updatedItem) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      
      res.json(updatedItem);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.delete("/api/cart/items/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const id = parseInt(req.params.id);
      const success = await storage.removeCartItem(id);
      
      if (!success) {
        return res.status(404).json({ message: "Cart item not found" });
      }
      
      res.status(204).end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  // Order routes
  app.get("/api/orders", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const userId = req.user.id;
      const orders = await storage.getOrders(userId);
      res.json(orders);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.get("/api/orders/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const id = parseInt(req.params.id);
      const order = await storage.getOrderWithItems(id);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Make sure user owns this order
      if (order.order.userId !== req.user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      res.json(order);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.post("/api/orders", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const userId = req.user.id;
      const orderData = insertOrderSchema.parse({
        ...req.body,
        userId
      });
      
      const order = await storage.createOrder(orderData);
      
      // Get cart items and convert to order items
      const cart = await storage.getCartWithItems(userId);
      
      if (cart && cart.items.length > 0) {
        // Add each cart item to order
        for (const item of cart.items) {
          const orderItemData = insertOrderItemSchema.parse({
            orderId: order.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.product.price
          });
          
          await storage.addOrderItem(orderItemData);
          
          // Remove item from cart
          await storage.removeCartItem(item.id);
        }
      }
      
      const orderWithItems = await storage.getOrderWithItems(order.id);
      res.status(201).json(orderWithItems);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  // Admin routes
  app.get("/api/check-admin", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const isAdmin = req.user.isAdmin === true;
      res.json({ isAdmin });
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Get all users
  app.get("/api/admin/users", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Create new user
  app.post("/api/admin/users", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Check if username or email already exists
      const existingUserByUsername = await storage.getUserByUsername(req.body.username);
      if (existingUserByUsername) {
        return res.status(400).json({ message: "Username already exists" });
      }
      
      // Verify the data is valid according to the schema
      const userData = insertUserSchema.parse(req.body);
      
      // Hash the password
      const hashedPassword = await hashPassword(userData.password);
      
      // Create user with hashed password
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword,
      });
      
      // Return the created user (without the password)
      const { password, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Get all orders
  app.get("/api/admin/orders", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const orders = await storage.getAllOrders();
      res.json(orders);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Create product
  app.post("/api/admin/products", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      console.log("Creating product with data:", req.body);
      
      try {
        // Validate the product data with the schema
        const productData = insertProductSchema.parse(req.body);
        const product = await storage.createProduct(productData);
        console.log("Product created successfully:", product);
        res.status(201).json(product);
      } catch (validationError) {
        console.error("Product validation failed:", validationError);
        return res.status(400).json({ 
          message: "Invalid product data", 
          details: validationError instanceof Error ? validationError.message : String(validationError)
        });
      }
    } catch (error) {
      console.error("Error creating product:", error);
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Update product
  app.patch("/api/admin/products/:id", async (req, res) => {
    try {
      console.log("Update product request received", { params: req.params, body: req.body });
      
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        console.log("User not authenticated or not admin", { isAuthenticated: req.isAuthenticated(), isAdmin: req.user?.isAdmin });
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const id = parseInt(req.params.id);
      console.log("Updating product", { id, data: req.body });
      
      // First check if product exists
      const existingProduct = await storage.getProduct(id);
      if (!existingProduct) {
        console.log("Product not found", { id });
        return res.status(404).json({ message: "Product not found" });
      }
      
      try {
        // Validate the product data with the schema
        const productData = insertProductSchema.parse(req.body);
        
        // Use our new updateProduct method which handles the ID properly
        const updatedProduct = await storage.updateProduct(id, productData);
        
        if (!updatedProduct) {
          console.log("Failed to update product, returned undefined");
          return res.status(404).json({ message: "Failed to update product" });
        }
        
        console.log("Product updated successfully", { updatedProduct });
        res.json(updatedProduct);
      } catch (validationError) {
        console.error("Product validation failed:", validationError);
        return res.status(400).json({ 
          message: "Invalid product data", 
          details: validationError instanceof Error ? validationError.message : String(validationError)
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      console.error("Error updating product", { error, message });
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Delete product
  app.delete("/api/admin/products/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const id = parseInt(req.params.id);
      const success = await storage.deleteProduct(id);
      
      if (!success) {
        return res.status(404).json({ message: "Product not found" });
      }
      
      res.status(204).end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Delete user
  app.delete("/api/admin/users/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const id = parseInt(req.params.id);
      
      // Don't allow deleting yourself
      if (id === req.user.id) {
        return res.status(400).json({ message: "Cannot delete yourself" });
      }
      
      const success = await storage.deleteUser(id);
      
      if (!success) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.status(204).end();
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Update user admin status
  app.patch("/api/admin/users/:id", async (req, res) => {
    try {
      console.log("Admin user update request received", { body: req.body, params: req.params });
      
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        console.log("User not authenticated or not admin", { isAuthenticated: req.isAuthenticated(), isAdmin: req.user?.isAdmin });
        return res.status(403).json({ message: "Forbidden" });
      }
      
      const id = parseInt(req.params.id);
      console.log("Parsing request body", { body: req.body });
      const { isAdmin } = z.object({ isAdmin: z.boolean() }).parse(req.body);
      console.log("Body parsed successfully", { id, isAdmin });
      
      // Don't allow removing your own admin privileges
      if (id === req.user.id && !isAdmin) {
        console.log("Attempt to remove own admin privileges", { userId: id, requesterId: req.user.id });
        return res.status(400).json({ message: "Cannot remove your own admin privileges" });
      }
      
      console.log("Updating user admin status", { id, isAdmin });
      const updatedUser = await storage.updateUserAdminStatus(id, isAdmin);
      
      if (!updatedUser) {
        console.log("User not found", { id });
        return res.status(404).json({ message: "User not found" });
      }
      
      console.log("User updated successfully", { updatedUser });
      res.json(updatedUser);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      console.error("Error updating user admin status", { error, message });
      res.status(500).json({ message });
    }
  });
  
  // Admin routes - Get analytics data
  app.get("/api/admin/analytics", async (req, res) => {
    try {
      if (!req.isAuthenticated() || !req.user.isAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }
      
      // Parse timeframe from query params with default value
      const timeframe = req.query.timeframe || '7d'; // default to 7 days
      let days = 7;
      
      // Convert timeframe to days
      if (timeframe === '30d') days = 30;
      else if (timeframe === '90d') days = 90;
      else if (timeframe === '7d') days = 7;
      
      const userCount = await storage.getUserCount();
      const orderCount = await storage.getOrderCount();
      const productCount = await storage.getProductCount();
      const revenue = await storage.getTotalRevenue();
      const orderStats = await storage.getOrderStats(days);
      const topProducts = await storage.getTopProducts(5);
      
      res.json({
        userCount,
        orderCount,
        productCount,
        revenue,
        orderStats,
        topProducts,
        timeframe
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  // Reviews routes
  app.get("/api/products/:id/reviews", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const reviews = await storage.getProductReviews(productId);
      res.json(reviews);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  app.post("/api/products/:id/reviews", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const productId = parseInt(req.params.id);
      const userId = req.user.id;
      
      const reviewData = insertReviewSchema.parse({
        ...req.body,
        productId,
        userId
      });
      
      const review = await storage.createReview(reviewData);
      res.status(201).json(review);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred";
      res.status(500).json({ message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
