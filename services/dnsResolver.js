const { Resolver } = require("dns").promises;

/**
 * Custom DNS Resolver that uses external DNS servers (Cloudflare/Google)
 * to avoid Ubuntu's systemd-resolved cache issues
 */
class CustomDNSResolver {
  constructor() {
    // Use Cloudflare and Google DNS servers (never use system default)
    this.resolver = new Resolver();
    this.resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]);
  }

  /**
   * Resolve A records for a domain using external DNS resolvers
   * @param {string} domain - Domain name to resolve
   * @returns {Promise<string[]>} Array of IPv4 addresses
   */
  async resolveARecords(domain) {
    try {
      const addresses = await this.resolver.resolve4(domain);
      return Array.isArray(addresses) ? addresses : [];
    } catch (err) {
      // Handle different DNS error codes
      if (err.code === "ENOTFOUND" || err.code === "NXDOMAIN") {
        // Domain doesn't exist yet
        return [];
      }
      if (err.code === "ETIMEDOUT") {
        // DNS query timed out
        throw new Error(`DNS query timeout for ${domain}`);
      }
      // Other errors
      throw new Error(`DNS resolution failed for ${domain}: ${err.message}`);
    }
  }

  /**
   * Check if a domain resolves to a specific IP address
   * @param {string} domain - Domain name to check
   * @param {string} expectedIp - Expected IP address
   * @returns {Promise<{match: boolean, addresses: string[], error?: string}>}
   */
  async checkARecord(domain, expectedIp) {
    try {
      const addresses = await this.resolveARecords(domain);
      const match = addresses.includes(expectedIp);
      
      return {
        match,
        addresses,
        error: null,
      };
    } catch (err) {
      return {
        match: false,
        addresses: [],
        error: err.message,
      };
    }
  }
}

// Export singleton instance
const dnsResolver = new CustomDNSResolver();

module.exports = {
  dnsResolver,
  CustomDNSResolver,
};

