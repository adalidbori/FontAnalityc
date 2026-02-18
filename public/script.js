// URLs are relative for production compatibility
document.addEventListener("DOMContentLoaded", () => {

  // Mapeo de rangos predefinidos a nombres de cache
  const CACHE_RANGE_MAP = {
    'Yesterday': 'yesterday',
    'This Week': 'thisWeek',
    'Last Week': 'lastWeek',
    'This Month': 'thisMonth',
    'Last Month': 'lastMonth'
  };

  // Variable para trackear el rango seleccionado
  let selectedRangeLabel = null;

  // Iconos por defecto para inboxes (basado en nombre)
  const INBOX_ICONS = {
    'Arrival Notice': 'fas fa-bullhorn',
    'Billing': 'fa-solid fa-calculator',
    'Concierge': 'fas fa-users',
    'Distribution': 'fa-solid fa-road',
    'Exports': 'fas fa-file-export',
    'Freight': 'fa-solid fa-truck',
    'ISF': 'fa-solid fa-file',
    'Pricing': 'fa-solid fa-money-bill',
    'Secto': 'fas fa-chart-line',
    'default': 'fas fa-inbox'
  };

  // Departments will be loaded from database
  let departments = [];
  const employees = [];

  // Global state
  let selectedDepartmentId = null;
  let selectedDepartmentName = null;
  let currentStartDate = moment();
  let currentEndDate = moment();
  let selectedOptions = [];
  let totalStats = { received: 0, sent: 0, avgTime: 0 };

  // Initialize - load departments first
  loadDepartments();
  initializeDatePicker();

  // Load departments from database
  async function loadDepartments() {
    try {
      const response = await fetch('/api/inboxes');
      if (!response.ok) throw new Error('Failed to load inboxes');

      const inboxes = await response.json();

      // Transform to department format with icons
      departments = inboxes.map(inbox => ({
        id: inbox.id,
        name: inbox.name,
        code: inbox.code,
        icon: INBOX_ICONS[inbox.name] || INBOX_ICONS['default']
      }));

      // Set default selection
      if (departments.length > 0) {
        selectedDepartmentId = departments[0].id;
        selectedDepartmentName = departments[0].name;
      }

      // Now render
      renderDepartmentMenu();
      renderEmployeeTable(selectedDepartmentId, selectedDepartmentName);
      updatePageTitle(selectedDepartmentName);
    } catch (error) {
      console.error('Error loading departments:', error);
      // Show error in sidebar
      document.getElementById('department-menu').innerHTML = `
        <div style="padding: 16px; color: var(--text-muted); text-align: center;">
          <i class="fas fa-exclamation-triangle"></i><br>
          Failed to load inboxes
        </div>
      `;
    }
  }

  function initializeSearchButton() {
    const searchButton = document.querySelector('.searchButton');
    const selectElement = document.querySelector('.form-select');

    searchButton.addEventListener("click", () => {
      // Add button loading state
      searchButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Searching...';
      searchButton.disabled = true;

      selectedOptions = Array.from(selectElement.selectedOptions).map(opt => ({
        id: opt.value,
        name: opt.innerText,
        email: opt.dataset.email,
      }));

      const contentContainer = document.getElementById("employee-content");

      if (selectedOptions.length === 0) {
        renderEmployeeTable(selectedDepartmentId, selectedDepartmentName);
        showLoadingState(contentContainer);
        actualizarDatos().finally(() => {
          resetSearchButton(searchButton);
        });
      } else {
        renderEmployeeTable(selectedDepartmentId, selectedDepartmentName, null, true);
        showLoadingState(contentContainer);
        actualizarDatosIndividuales(selectedOptions).finally(() => {
          resetSearchButton(searchButton);
          Array.from(selectElement.options).forEach(option => {
            option.selected = false;
          });
        });
      }
    });
  }

  function resetSearchButton(button) {
    button.innerHTML = '<i class="fas fa-magnifying-glass"></i> Search';
    button.disabled = false;
  }

  function showLoadingState(container) {
    const loadingHTML = `
      <div class="table-container">
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <p class="loading-text">Fetching analytics data...</p>
        </div>
      </div>
    `;
    container.innerHTML = loadingHTML;
  }

  function updatePageTitle(departmentName, isIndividual = false) {
    const titleElement = document.getElementById('inbox-title');
    const iconElement = document.querySelector('.page-title-icon i');

    if (isIndividual) {
      titleElement.textContent = 'Individual Inbox Analytics';
      iconElement.className = 'fas fa-user';
    } else {
      titleElement.textContent = `${departmentName} Inbox`;
      const dept = departments.find(d => d.name === departmentName);
      iconElement.className = dept ? dept.icon : 'fas fa-inbox';
    }
  }

  function renderDepartmentMenu() {
    const menuContainer = document.getElementById("department-menu");
    menuContainer.innerHTML = "";

    departments.forEach((department, index) => {
      const navItem = document.createElement("div");
      navItem.className = "nav-item animate-slide-in";
      navItem.style.animationDelay = `${index * 0.05}s`;

      const button = document.createElement("button");
      button.className = `nav-link ${department.id === selectedDepartmentId ? "active" : ""}`;
      button.innerHTML = `
        <span class="nav-icon"><i class="${department.icon}"></i></span>
        <span>${department.name}</span>
      `;

      button.addEventListener("click", () => {
        selectedDepartmentId = department.id;
        selectedDepartmentName = department.name;

        document.querySelectorAll("#department-menu .nav-link").forEach((el) => {
          el.classList.remove("active");
        });
        button.classList.add("active");

        updatePageTitle(department.name);
        renderEmployeeTable(selectedDepartmentId, selectedDepartmentName);
      });

      navItem.appendChild(button);
      menuContainer.appendChild(navItem);
    });

    // Load individual users
    obtenerRegistrosindividuales()
      .then(users => {
        populateDropdown(users);
      })
      .catch(error => {
        console.error('Error al obtener registros individuales:', error);
      });
  }

  function renderStatsCards(data) {
    const statsContainer = document.getElementById('stats-container');

    if (!data || data.length === 0) {
      statsContainer.innerHTML = '';
      return;
    }

    let totalReceived = 0;
    let totalSent = 0;
    let totalTime = 0;
    let validTimeCount = 0;

    data.forEach(result => {
      if (result.apiData && result.apiData.metrics) {
        totalReceived += result.apiData.metrics[0].value || 0;
        totalSent += result.apiData.metrics[1].value || 0;
        const time = result.apiData.metrics[2].value || 0;
        if (time > 0) {
          totalTime += time;
          validTimeCount++;
        }
      }
    });

    const avgTime = validTimeCount > 0 ? totalTime / validTimeCount : 0;
    const avgHours = Math.floor(avgTime / 3600);
    const avgMinutes = Math.floor((avgTime % 3600) / 60);

    statsContainer.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon">
          <i class="fas fa-envelope-open"></i>
        </div>
        <div class="stat-value">${totalReceived.toLocaleString()}</div>
        <div class="stat-label">Messages Received</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">
          <i class="fas fa-paper-plane"></i>
        </div>
        <div class="stat-value">${totalSent.toLocaleString()}</div>
        <div class="stat-label">Messages Sent</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">
          <i class="fas fa-clock"></i>
        </div>
        <div class="stat-value">${avgHours}h ${avgMinutes}m</div>
        <div class="stat-label">Avg Response Time</div>
      </div>
    `;
  }

  function renderEmployeeTable(departmentId = null, selectedDepartmentName, apiResponses = null, isIndividual = null) {
    console.log('renderEmployeeTable called:', {
      departmentId,
      selectedDepartmentName,
      apiResponsesCount: apiResponses ? apiResponses.length : 0,
      isIndividual
    });

    const contentContainer = document.getElementById("employee-content");
    const departmentEmployees = employees.filter((emp) => emp.departmentId === departmentId);
    const department = departments.find((dept) => dept.id === departmentId);
    let departmentName = department ? department.name : 'Unknown';

    if (isIndividual) {
      departmentName = 'Individual';
      updatePageTitle(departmentName, true);
    }

    // Render stats if we have data
    if (apiResponses && apiResponses.length > 0) {
      renderStatsCards(apiResponses);
    } else {
      document.getElementById('stats-container').innerHTML = '';
    }

    let html = `
      <div class="table-container">
        <div class="table-header">
          <h3 class="table-title">
            <i class="fas fa-table"></i>
            Employee Metrics
          </h3>
          ${apiResponses ? `<span class="table-badge">${apiResponses.length} Records</span>` : ''}
        </div>
        <div class="table-wrapper">
          <table id="miTabla" class="display">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th class="text-center">Messages Received</th>
                <th class="text-center">Messages Sent</th>
                <th class="text-center">Avg Reply Time</th>
              </tr>
            </thead>
            <tbody>
    `;

    departmentEmployees.forEach((employee) => {
      html += `
        <tr>
          <td class="fw-medium">${employee.name}</td>
          <td><a href="mailto:${employee.email}">${employee.email}</a></td>
          <td class="text-center"><span class="metric-value">${employee.messagesReceived}</span></td>
          <td class="text-center"><span class="metric-value">${employee.messagesSent}</span></td>
          <td class="text-center"><span class="metric-value">${employee.avgReplyTime}</span></td>
        </tr>
      `;
    });

    if (apiResponses) {
      console.log('Processing apiResponses:', apiResponses.length, 'records');
      console.log('First result full structure:', JSON.stringify(apiResponses[0], null, 2));
      let rowsAdded = 0;
      apiResponses.forEach((result, idx) => {
        console.log(`Row ${idx}:`, {
          hasApiData: !!result.apiData,
          hasMetrics: result.apiData ? !!result.apiData.metrics : false,
          record: result.record?.name,
          error: result.error || null
        });
        if (result.apiData && result.apiData.metrics) {
          rowsAdded++;
          const totalSeconds = Math.round(result.apiData.metrics[2].value);
          const hours = Math.floor(totalSeconds / 3600);
          const minutes = Math.floor((totalSeconds % 3600) / 60);
          const formattedTime = `${hours}h ${minutes}m`;
          const timeClass = totalSeconds > 7200 ? 'text-danger' : 'text-success';

          html += `
            <tr>
              <td class="fw-medium">${result.record.name}</td>
              <td><a href="mailto:${result.record.email || ''}">${result.record.email || '-'}</a></td>
              <td class="text-center"><span class="metric-value">${result.apiData.metrics[0].value}</span></td>
              <td class="text-center"><span class="metric-value">${result.apiData.metrics[1].value}</span></td>
              <td class="text-center"><span class="${timeClass}">${formattedTime}</span></td>
            </tr>
          `;
        }
      });
      console.log('Total rows added:', rowsAdded);

      // Initialize DataTable after content is rendered
      setTimeout(() => {
        if ($.fn.DataTable.isDataTable('#miTabla')) {
          $('#miTabla').DataTable().destroy();
        }
        $('#miTabla').DataTable({
          pageLength: 25,
          order: [[2, 'desc']],
          language: {
            search: "Filter:",
            lengthMenu: "Show _MENU_ entries",
            info: "Showing _START_ to _END_ of _TOTAL_ employees",
            paginate: {
              first: '<i class="fas fa-angles-left"></i>',
              last: '<i class="fas fa-angles-right"></i>',
              next: '<i class="fas fa-angle-right"></i>',
              previous: '<i class="fas fa-angle-left"></i>'
            }
          }
        });
      }, 100);
    }

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;

    contentContainer.innerHTML = html;

    // Show empty state if no data
    if (!apiResponses && departmentEmployees.length === 0) {
      contentContainer.innerHTML = `
        <div class="table-container">
          <div class="empty-state">
            <div class="empty-state-icon">
              <i class="fas fa-inbox"></i>
            </div>
            <h3 class="empty-state-title">No Data Available</h3>
            <p class="empty-state-text">Select a date range and click Search to load analytics data.</p>
          </div>
        </div>
      `;
    }
  }

  function initializeDatePicker() {
    $('#daterange').daterangepicker({
      opens: 'right',
      autoUpdateInput: true,
      locale: {
        format: 'MMM D, YYYY',
        separator: '  -  ',
        applyLabel: 'Apply',
        cancelLabel: 'Cancel',
        customRangeLabel: 'Custom Range'
      },
      startDate: currentStartDate,
      endDate: currentEndDate,
      ranges: {
        'Today': [moment(), moment()],
        'Yesterday': [moment().subtract(1, 'days'), moment().subtract(1, 'days')],
        'This Week': [moment().startOf('week'), moment()],
        'Last Week': [moment().subtract(1, 'week').startOf('week'), moment().subtract(1, 'week').endOf('week')],
        'This Month': [moment().startOf('month'), moment()],
        'Last Month': [
          moment().subtract(1, 'month').startOf('month'),
          moment().subtract(1, 'month').endOf('month')
        ]
      }
    }, function (start, end, label) {
      currentStartDate = start;
      currentEndDate = end;
      // Guardar el label del rango para saber si usar cache
      selectedRangeLabel = label;
      console.log('Range selected:', label);
    });
  }

  /**
   * Intenta obtener datos del cache
   * Retorna null si no hay cache disponible
   */
  async function tryGetCachedData(departmentName, rangeLabel) {
    const cacheRange = CACHE_RANGE_MAP[rangeLabel];
    if (!cacheRange) {
      console.log('Range not cacheable:', rangeLabel);
      return null;
    }

    try {
      const response = await fetch(
        `/getCachedData?department=${encodeURIComponent(departmentName)}&range=${cacheRange}`
      );

      if (!response.ok) {
        console.log('Cache not available:', response.status);
        return null;
      }

      const data = await response.json();
      console.log('Using cached data:', data.cacheAge);
      return data;
    } catch (error) {
      console.error('Error fetching cache:', error);
      return null;
    }
  }

  async function actualizarDatos() {
    // Primero intentar obtener datos del cache si es un rango predefinido
    if (selectedRangeLabel && CACHE_RANGE_MAP[selectedRangeLabel]) {
      console.log('Trying to use cache for:', selectedDepartmentName, selectedRangeLabel);
      const cachedData = await tryGetCachedData(selectedDepartmentName, selectedRangeLabel);

      if (cachedData && cachedData.apiResponses) {
        console.log('Cache hit! Using cached data.');
        console.log('Cache data details:', {
          department: cachedData.department,
          totalRecords: cachedData.totalRecords,
          apiResponsesCount: cachedData.apiResponses.length,
          selectedDepartmentId,
          selectedDepartmentName
        });
        showCacheIndicator(cachedData.cacheAge);
        renderEmployeeTable(selectedDepartmentId, selectedDepartmentName, cachedData.apiResponses);
        return;
      }
      console.log('Cache miss. Fetching from API...');
    }

    // Si no hay cache, hacer la llamada normal
    const startTimestampSeconds = currentStartDate.unix();
    const endUTC5 = moment.tz(currentEndDate.format('YYYY-MM-DD'), 'America/New_York');
    const endTimestampSeconds = endUTC5.unix();

    try {
      const registros = await obtenerRegistrosPorInbox(selectedDepartmentName);
      const data = await callApi(startTimestampSeconds, endTimestampSeconds, registros);
      const apiResponses = data.apiResponses || [];
      hideCacheIndicator();
      renderEmployeeTable(selectedDepartmentId, selectedDepartmentName, apiResponses);
    } catch (error) {
      console.error('Error al procesar datos:', error);
      renderEmployeeTable(selectedDepartmentId, selectedDepartmentName, [{
        recordIndex: 1,
        record: { name: 'Error', email: '', position: '' },
        error: error.message
      }]);
    }
  }

  /**
   * Muestra indicador de que los datos vienen del cache
   */
  function showCacheIndicator(cacheAge) {
    let indicator = document.getElementById('cache-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'cache-indicator';
      indicator.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: linear-gradient(135deg, #10b981, #059669);
        color: white;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        margin-left: 12px;
      `;
      const header = document.querySelector('.table-header');
      if (header) {
        header.appendChild(indicator);
      }
    }
    indicator.innerHTML = `<i class="fas fa-bolt"></i> Instant (cached ${cacheAge})`;
    indicator.style.display = 'inline-flex';
  }

  function hideCacheIndicator() {
    const indicator = document.getElementById('cache-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  async function actualizarDatosIndividuales(inboxes) {
    const startTimestampSeconds = currentStartDate.unix();
    const endUTC5 = moment.tz(currentEndDate.format('YYYY-MM-DD'), 'America/New_York');
    const endTimestampSeconds = endUTC5.unix();

    try {
      const data = await callApiIndividuals(startTimestampSeconds, endTimestampSeconds, inboxes);
      const apiResponses = data.apiResponses || [];
      renderEmployeeTable(selectedDepartmentId, selectedDepartmentName, apiResponses, true);
    } catch (error) {
      console.error('Error al procesar datos:', error);
      renderEmployeeTable(selectedDepartmentId, selectedDepartmentName, [{
        recordIndex: 1,
        record: { name: 'Error', email: '', position: '' },
        error: error.message
      }]);
    }
  }

  async function callApi(timestampStart, timestampEnd, registros) {
    try {
      if (!timestampStart || !timestampEnd || !Array.isArray(registros)) {
        throw new Error('Faltan datos requeridos: timestampStart, timestampEnd o registros');
      }

      const response = await fetch('/getData', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestampStart, timestampEnd, registros }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Error del servidor: ${errorData.error || response.statusText || 'Unknown error'}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error al llamar al API:', error.message);
      throw error;
    }
  }

  async function callApiIndividuals(timestampStart, timestampEnd, inboxes) {
    try {
      if (!timestampStart || !timestampEnd || !Array.isArray(inboxes)) {
        throw new Error('Faltan datos requeridos: timestampStart, timestampEnd o registros');
      }

      const response = await fetch('/getDataIndividuals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestampStart, timestampEnd, inboxes }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Error del servidor: ${errorData.error || response.statusText || 'Unknown error'}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error al llamar al API:', error.message);
      throw error;
    }
  }

  async function obtenerRegistrosPorInbox(nombreInbox) {
    nombreInbox = !nombreInbox ? 'Secto' : nombreInbox;
    try {
      // Usar nuevo endpoint de la API (PostgreSQL)
      const respuesta = await fetch(`/api/analytics/inbox/${encodeURIComponent(nombreInbox)}`);
      if (!respuesta.ok) {
        throw new Error(`Error al obtener datos: ${respuesta.status} ${respuesta.statusText}`);
      }
      const datos = await respuesta.json();
      return datos;
    } catch (error) {
      console.error('Error al obtener registros:', error);
      return [];
    }
  }

  async function obtenerRegistrosindividuales() {
    try {
      // Usar nuevo endpoint de la API (PostgreSQL)
      const respuesta = await fetch('/api/analytics/individuals');
      if (!respuesta.ok) {
        throw new Error(`Error al obtener datos: ${respuesta.status} ${respuesta.statusText}`);
      }
      const datos = await respuesta.json();
      return datos;
    } catch (error) {
      console.error('Error al obtener registros:', error);
      return [];
    }
  }

  function populateDropdown(users) {
    const userDropdownWrapper = document.getElementById("user-dropdown-wrapper");

    // Create search input
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search users...";
    searchInput.className = "user-search-input";
    searchInput.style.cssText = `
      width: 100%;
      padding: 10px 12px;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-primary);
      font-size: 0.85rem;
      outline: none;
    `;

    // Create select element
    const selectElement = document.createElement("select");
    selectElement.setAttribute("multiple", "multiple");
    selectElement.className = "form-select";

    users.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.innerText = user.name;
      option.dataset.email = user.email;
      selectElement.appendChild(option);
    });

    // Filter functionality
    searchInput.addEventListener("input", (e) => {
      const searchTerm = e.target.value.toLowerCase();
      Array.from(selectElement.options).forEach(option => {
        const matches = option.text.toLowerCase().includes(searchTerm);
        option.style.display = matches ? '' : 'none';
      });
    });

    userDropdownWrapper.innerHTML = '';
    userDropdownWrapper.appendChild(searchInput);
    userDropdownWrapper.appendChild(selectElement);

    initializeSearchButton();
  }

});
