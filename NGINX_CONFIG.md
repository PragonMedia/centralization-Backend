# Dynamic Landing Page Architecture - System Documentation

## Overview

This system provides a **centralized, template-based architecture** for dynamically generating landing pages. The architecture separates presentation (HTML templates) from content (JSON data), enabling rapid deployment of multiple landing page variants without code changes.

---

## Architecture Components

### 1. **Nginx Server Configuration Layer**

**Location**: `nginx-1.27.5/conf/nginx_dynamic.conf`

The system uses Nginx as a reverse proxy and static file server. Each domain has its own server block configured with:

- **Multiple domain routing**: Each server block handles one or more domains (e.g., `paragonmedia.com`, `premiumbenefits.com`)
- **Subdirectory routing**: Each domain can have multiple subdirectory routes (e.g., `/landing-page/`, `/offer-page/`, `/nn/`)
- **PHP support**: Configured to handle PHP processing via FastCGI for dynamic server-side operations
- **Static file serving**: Serves HTML templates, JavaScript files, and JSON content files directly

**Example Configuration Pattern**:

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    root /var/www/example;
    index index.php index.html;

    location /subdirectory/ {
        root /var/www/example;
        try_files $uri $uri/ /subdirectory/index.php?$query_string;
    }
}
```

---

### 2. **Template System**

**Location**: `nginx-1.27.5/html/templates/`

Templates are reusable HTML structures that define the layout and UI components of landing pages. Each template includes:

- **Static HTML structure**: Defines the page layout, sections, and UI elements
- **Placeholder elements**: HTML elements with specific IDs that will be populated with dynamic content
- **Template-specific JavaScript**: Logic for handling user interactions, form submissions, and tracking

**Template Structure**:

```
templates/
  ├── template1/
  │   ├── index.html          # HTML structure
  │   ├── landing.js          # Template-specific logic
  │   └── assets/             # CSS, images, audio files
  ├── template2/
  │   ├── index.html
  │   ├── script.js
  │   └── assets/
  └── pgnm-chatbot-groceries/
      ├── index.html
      ├── script.js
      └── assets/
```

**Key Template Features**:

- Templates contain static placeholders (e.g., `<h1 id="mainTitle">Loading...</h1>`)
- JavaScript dynamically replaces placeholder text with content from JSON files
- Each template can have its own styling, animations, and interaction patterns

---

### 3. **Content JSON Files**

**Location**: `nginx-1.27.5/html/content/`

Content is stored in JSON format, completely separated from presentation. This allows:

- **Non-technical content updates**: Marketing teams can update content without touching code
- **A/B testing**: Easy creation of content variants by creating new JSON files
- **Multi-template support**: Same content structure can be used across different templates

**Content Structure**:

```
content/
  ├── template1/
  │   ├── nn.json             # Content for route "nn"
  │   └── nn1.json            # Content for route "nn1"
  ├── pgnm-chatbot-groceries.json
  ├── pgnm-general-quiz.json
  └── pgnm-grocery-quiz.json
```

**JSON Content Example**:

```json
{
  "mainTitle": "Ending Soonest: 2025 Medicare Giveback Benefit...",
  "mainDescription": "Use Your Part B Premium to get money back...",
  "btnOne": "See If You Qualify",
  "btnTwo": "See If You Qualify",
  "questionOne": "What is your age range?",
  "firstQuestionBtn1": "UNDER 65",
  "firstQuestionBtn2": "65 TO 70",
  "testimonialOne": "Getting the Social Security giveback has made...",
  "phone-number": "+1 (866) 498-2822"
}
```

---

### 4. **Dynamic Content Injection (JavaScript)**

**Location**: `nginx-1.27.5/html/templates/[template-name]/[script-file].js`

The JavaScript layer handles the dynamic population of templates:

**Workflow**:

1. **Extract route from URL**: Parses the current URL path to determine which content file to load

   ```javascript
   const route = window.location.pathname.split("/")[1]; // e.g., "nn", "landing-page"
   const pageKey = pathname || "default";
   ```

2. **Fetch JSON content**: Makes an HTTP request to load the appropriate JSON file

   ```javascript
   const response = await fetch(`/content/template1/${pageKey}.json`);
   const data = await response.json();
   ```

3. **Inject content into DOM**: Populates HTML elements with content from JSON

   ```javascript
   document.getElementById("mainTitle").textContent = data.mainTitle;
   document.getElementById("btnOne").textContent = data.btnOne;
   ```

4. **Handle dynamic configuration**: Some templates fetch additional configuration (tracking IDs, phone numbers) from a backend API

   ```javascript
   const configRes = await fetch(`http://localhost:3000/api/v1/data`, {
     method: "POST",
     body: JSON.stringify({ domain, route }),
   });
   ```

5. **Track user interactions**: Implements tracking scripts (Ringba, RedTrack) and captures user behavior

---

### 5. **Routing Logic**

The system uses a **pathname-based routing** strategy:

- **URL Pattern**: `https://domain.com/route-name/`
- **Route Resolution**:
  - Extracts the first path segment (e.g., `/nn/` → `nn`)
  - Maps route name to JSON file: `/content/template1/nn.json`
  - Falls back to `default.json` if route not found

**Special Route Handling**:

- Some routes are designated as "template routes" (e.g., `nn`, `landing-page`) and serve the template directly without JSON override
- Other routes dynamically load JSON content to populate the template

---

## Data Flow

```
1. User visits: https://example.com/nn/
                ↓
2. Nginx serves: /templates/template1/index.html
                ↓
3. Browser loads: template1/landing.js
                ↓
4. JavaScript extracts route: "nn"
                ↓
5. Fetches content: /content/template1/nn.json
                ↓
6. Populates HTML elements with JSON data
                ↓
7. Renders fully dynamic landing page
```

---

## Key Architectural Benefits

### 1. **Separation of Concerns**

- **Presentation** (HTML/CSS) → Templates
- **Content** (Text/Data) → JSON files
- **Logic** (Interactions) → JavaScript

### 2. **Scalability**

- Add new landing pages by creating new JSON files (no code deployment needed)
- Multiple templates can share the same content structure
- Support for hundreds of landing page variants

### 3. **Maintainability**

- Update content without redeploying code
- Template changes affect all pages using that template
- Centralized configuration management

### 4. **A/B Testing Support**

- Easy content variant creation (e.g., `nn.json`, `nn-v2.json`, `nn-v3.json`)
- Quick template switching via route configuration
- Analytics tracking built into templates

### 5. **Multi-Domain Support**

- Single codebase serves multiple domains
- Domain-specific routing via Nginx configuration
- Shared templates across different domains

---

## Usage Patterns

### Creating a New Landing Page Variant

1. **Create JSON content file**:

   ```json
   // content/template1/my-new-page.json
   {
     "mainTitle": "My New Landing Page Title",
     "mainDescription": "Description here...",
     ...
   }
   ```

2. **Access via URL**:

   ```
   https://domain.com/my-new-page/
   ```

3. **System automatically**:
   - Serves the template HTML
   - Loads `my-new-page.json`
   - Injects content into the template
   - Renders the complete page

### Creating a New Template

1. **Create template directory**:

   ```
   templates/my-new-template/
     ├── index.html
     ├── script.js
     └── assets/
   ```

2. **Design HTML structure** with placeholder IDs:

   ```html
   <h1 id="mainTitle">Loading...</h1>
   <p id="description">Loading...</p>
   ```

3. **Implement JavaScript** to fetch and inject JSON content

4. **Configure Nginx** to serve the template at desired routes

---

## Integration Points

### Backend API Integration

Templates can fetch dynamic configuration from a backend API:

- **Tracking IDs** (RedTrack, Ringba)
- **Phone numbers** (dynamic call tracking)
- **Domain-specific settings**

### Third-Party Services

- **Ringba**: Call tracking and routing
- **RedTrack**: Affiliate tracking and conversion tracking
- **Analytics**: User behavior tracking

---

## Technical Stack

- **Web Server**: Nginx (reverse proxy, static file serving)
- **Backend**: PHP 8.4 (FastCGI) for server-side processing
- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Content Format**: JSON
- **Deployment**: File-based (no build process required)

---

## Security Considerations

- **Content Sanitization**: JSON content should be validated before injection to prevent XSS
- **CORS Configuration**: JSON files served from same origin (no CORS issues)
- **File Access Control**: Nginx configuration restricts access to sensitive files (`.htaccess` blocking)
- **SSL/TLS**: HTTPS support via Let's Encrypt certificates

---

## Future Enhancement Opportunities

1. **Content Management System**: Web UI for non-technical users to edit JSON content
2. **Template Builder**: Visual editor for creating new templates
3. **Version Control**: Git-based versioning for content files
4. **Caching Layer**: CDN or Redis caching for JSON content
5. **Preview Mode**: Preview changes before going live
6. **Analytics Dashboard**: Centralized reporting across all landing pages

---

## Example: Complete Request Flow

**Request**: `GET https://premiumbenefits.com/nn/`

1. **Nginx** receives request and routes to `/nn/` location block
2. **Serves** `/templates/template1/index.html`
3. **Browser** loads HTML, CSS, and `landing.js`
4. **JavaScript** executes:
   - Extracts route: `"nn"`
   - Fetches: `/content/template1/nn.json`
   - Receives JSON data
   - Calls backend API: `POST /api/v1/data` with `{domain: "premiumbenefits.com", route: "nn"}`
   - Receives tracking IDs and phone number
   - Populates all HTML elements with content
   - Initializes tracking scripts
5. **User** sees fully rendered landing page with dynamic content

---

This architecture enables rapid iteration, easy content management, and scalable landing page deployment for marketing campaigns.
