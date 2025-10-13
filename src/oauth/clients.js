const { connectDB, sql } = require('../config/database');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const oauthConfig = require('../config/oauth');
const authConfig = require('../config/auth');

class OAuth2ClientManager {
  // Initialize default clients on server start
  async initializeDefaultClients() {
    const pool = await connectDB();

    try {
      console.log('🔄 Initializing OAuth 2.0 clients...');

      for (const clientData of oauthConfig.defaultClients) {
        const existingClient = await pool.request()
          .input('clientId', sql.VarChar(100), clientData.clientId)
          .query(`
            SELECT client_id FROM oauth_clients
            WHERE client_id = @clientId
          `);

        if (existingClient.recordset.length === 0) {
          // Hash the client secret
          const hashedSecret = await bcrypt.hash(clientData.clientSecret, authConfig.bcrypt.saltRounds);

          await pool.request()
            .input('id', sql.UniqueIdentifier, uuidv4())
            .input('clientId', sql.VarChar(100), clientData.clientId)
            .input('clientSecret', sql.VarChar(255), hashedSecret)
            .input('name', sql.VarChar(200), clientData.name)
            .input('grants', sql.VarChar(500), clientData.grants)
            .input('redirectUris', sql.VarChar(1000), clientData.redirectUris)
            .input('scope', sql.VarChar(500), clientData.scope)
            .query(`
              INSERT INTO oauth_clients
              (id, client_id, client_secret, name, grants, redirect_uris, scope, is_confidential, is_active)
              VALUES (@id, @clientId, @clientSecret, @name, @grants, @redirectUris, @scope, 1, 1)
            `);

          console.log(`✅ Created OAuth client: ${clientData.name} (${clientData.clientId})`);
        } else {
          console.log(`📝 OAuth client already exists: ${clientData.name} (${clientData.clientId})`);
        }
      }

      console.log('🎉 OAuth 2.0 clients initialized successfully!');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize OAuth clients:', error);
      throw error;
    }
  }

  // Register a new OAuth client
  async registerClient(clientData) {
    const pool = await connectDB();

    try {
      // Check if client ID already exists
      const existingClient = await pool.request()
        .input('clientId', sql.VarChar(100), clientData.clientId)
        .query(`
          SELECT client_id FROM oauth_clients
          WHERE client_id = @clientId
        `);

      if (existingClient.recordset.length > 0) {
        throw new Error(`Client ID '${clientData.clientId}' already exists`);
      }

      // Hash the client secret
      const hashedSecret = await bcrypt.hash(clientData.clientSecret, authConfig.bcrypt.saltRounds);

      // Insert new client
      const clientId = uuidv4();
      await pool.request()
        .input('id', sql.UniqueIdentifier, clientId)
        .input('clientId', sql.VarChar(100), clientData.clientId)
        .input('clientSecret', sql.VarChar(255), hashedSecret)
        .input('name', sql.VarChar(200), clientData.name)
        .input('grants', sql.VarChar(500), clientData.grants || 'authorization_code,refresh_token')
        .input('redirectUris', sql.VarChar(1000), clientData.redirectUris || '')
        .input('scope', sql.VarChar(500), clientData.scope || 'read')
        .input('isConfidential', sql.Bit, clientData.isConfidential !== false)
        .query(`
          INSERT INTO oauth_clients
          (id, client_id, client_secret, name, grants, redirect_uris, scope, is_confidential, is_active)
          VALUES (@id, @clientId, @clientSecret, @name, @grants, @redirectUris, @scope, @isConfidential, 1)
        `);

      return {
        id: clientId,
        clientId: clientData.clientId,
        name: clientData.name,
        grants: clientData.grants || 'authorization_code,refresh_token',
        redirectUris: clientData.redirectUris || '',
        scope: clientData.scope || 'read',
        isConfidential: clientData.isConfidential !== false,
        isActive: true,
        createdAt: new Date()
      };
    } catch (error) {
      console.error('Error registering OAuth client:', error);
      throw error;
    }
  }

  // Get client by client ID
  async getClient(clientId, includeSecret = false) {
    const pool = await connectDB();

    try {
      const selectFields = includeSecret
        ? 'id, client_id, client_secret, name, grants, redirect_uris, scope, is_confidential, is_active, created_at, updated_at'
        : 'id, client_id, name, grants, redirect_uris, scope, is_confidential, is_active, created_at, updated_at';

      const result = await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .query(`
          SELECT ${selectFields}
          FROM oauth_clients
          WHERE client_id = @clientId AND is_active = 1
        `);

      if (result.recordset.length === 0) {
        return null;
      }

      const client = result.recordset[0];
      return {
        id: client.id,
        clientId: client.client_id,
        clientSecret: client.client_secret || undefined,
        name: client.name,
        grants: client.grants.split(',').map(g => g.trim()),
        redirectUris: client.redirect_uris ? client.redirect_uris.split(',').map(u => u.trim()) : [],
        scope: client.scope,
        isConfidential: client.is_confidential,
        isActive: client.is_active,
        createdAt: client.created_at,
        updatedAt: client.updated_at
      };
    } catch (error) {
      console.error('Error getting OAuth client:', error);
      throw error;
    }
  }

  // List all clients
  async listClients(page = 1, limit = 10) {
    const pool = await connectDB();

    try {
      const offset = (page - 1) * limit;

      const result = await pool.request()
        .input('limit', sql.Int, limit)
        .input('offset', sql.Int, offset)
        .query(`
          SELECT id, client_id, name, grants, redirect_uris, scope, is_confidential, is_active, created_at, updated_at
          FROM oauth_clients
          ORDER BY created_at DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      const countResult = await pool.request()
        .query('SELECT COUNT(*) as total FROM oauth_clients');

      const clients = result.recordset.map(client => ({
        id: client.id,
        clientId: client.client_id,
        name: client.name,
        grants: client.grants.split(',').map(g => g.trim()),
        redirectUris: client.redirect_uris ? client.redirect_uris.split(',').map(u => u.trim()) : [],
        scope: client.scope,
        isConfidential: client.is_confidential,
        isActive: client.is_active,
        createdAt: client.created_at,
        updatedAt: client.updated_at
      }));

      return {
        clients,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error('Error listing OAuth clients:', error);
      throw error;
    }
  }

  // Update client
  async updateClient(clientId, updateData) {
    const pool = await connectDB();

    try {
      const updates = [];
      const inputs = [['clientId', sql.VarChar(100), clientId]];

      if (updateData.name) {
        updates.push('name = @name');
        inputs.push(['name', sql.VarChar(200), updateData.name]);
      }

      if (updateData.grants) {
        updates.push('grants = @grants');
        inputs.push(['grants', sql.VarChar(500), updateData.grants]);
      }

      if (updateData.redirectUris) {
        updates.push('redirect_uris = @redirectUris');
        inputs.push(['redirectUris', sql.VarChar(1000), updateData.redirectUris]);
      }

      if (updateData.scope) {
        updates.push('scope = @scope');
        inputs.push(['scope', sql.VarChar(500), updateData.scope]);
      }

      if (updateData.clientSecret) {
        const hashedSecret = await bcrypt.hash(updateData.clientSecret, authConfig.bcrypt.saltRounds);
        updates.push('client_secret = @clientSecret');
        inputs.push(['clientSecret', sql.VarChar(255), hashedSecret]);
      }

      if (updateData.isActive !== undefined) {
        updates.push('is_active = @isActive');
        inputs.push(['isActive', sql.Bit, updateData.isActive]);
      }

      if (updates.length === 0) {
        throw new Error('No valid update fields provided');
      }

      updates.push('updated_at = GETUTCDATE()');

      let request = pool.request();
      inputs.forEach(([name, type, value]) => {
        request.input(name, type, value);
      });

      const result = await request.query(`
        UPDATE oauth_clients
        SET ${updates.join(', ')}
        WHERE client_id = @clientId
      `);

      if (result.rowsAffected[0] === 0) {
        throw new Error('Client not found');
      }

      return await this.getClient(clientId);
    } catch (error) {
      console.error('Error updating OAuth client:', error);
      throw error;
    }
  }

  // Delete client (soft delete)
  async deleteClient(clientId) {
    const pool = await connectDB();

    try {
      const result = await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .query(`
          UPDATE oauth_clients
          SET is_active = 0, updated_at = GETUTCDATE()
          WHERE client_id = @clientId
        `);

      if (result.rowsAffected[0] === 0) {
        throw new Error('Client not found');
      }

      // Revoke all tokens for this client
      await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .query(`
          UPDATE oauth_access_tokens
          SET is_revoked = 1
          WHERE client_id = @clientId
        `);

      await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .query(`
          UPDATE oauth_refresh_tokens
          SET is_revoked = 1
          WHERE client_id = @clientId
        `);

      return true;
    } catch (error) {
      console.error('Error deleting OAuth client:', error);
      throw error;
    }
  }

  // Regenerate client secret
  async regenerateClientSecret(clientId) {
    const newSecret = uuidv4().replace(/-/g, '');
    const hashedSecret = await bcrypt.hash(newSecret, authConfig.bcrypt.saltRounds);

    const pool = await connectDB();

    try {
      const result = await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .input('clientSecret', sql.VarChar(255), hashedSecret)
        .query(`
          UPDATE oauth_clients
          SET client_secret = @clientSecret, updated_at = GETUTCDATE()
          WHERE client_id = @clientId AND is_active = 1
        `);

      if (result.rowsAffected[0] === 0) {
        throw new Error('Client not found or inactive');
      }

      // Revoke all existing tokens for security
      await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .query(`
          UPDATE oauth_access_tokens
          SET is_revoked = 1
          WHERE client_id = @clientId
        `);

      await pool.request()
        .input('clientId', sql.VarChar(100), clientId)
        .query(`
          UPDATE oauth_refresh_tokens
          SET is_revoked = 1
          WHERE client_id = @clientId
        `);

      return {
        clientId,
        clientSecret: newSecret,
        message: 'Client secret regenerated successfully. All existing tokens have been revoked.'
      };
    } catch (error) {
      console.error('Error regenerating client secret:', error);
      throw error;
    }
  }
}

module.exports = new OAuth2ClientManager();