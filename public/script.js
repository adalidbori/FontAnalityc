window.miVariable = "192.168.1.158";
document.addEventListener("DOMContentLoaded", () => {

  // Mock data for departments (replace with actual data source)
  const departments = [
    { id: 8, name: "Arribal Notice", icon: "fas fa-bullhorn" },
    { id: 2, name: "Billing", icon: "fa-solid fa-calculator" },
    { id: 3, name: "Concierge", icon: "fas fa-users" },
    { id: 9, name: "Distribution", icon: "fa-solid fa-road" },
    { id: 4, name: "Exports", icon: "fas fa-code" },
    { id: 5, name: "Freight", icon: "fa-solid fa-truck" },
    { id: 7, name: "ISF", icon: "fa-solid fa-file" },
    { id: 6, name: "Pricing", icon: "fa-solid fa-money-bill" },
    { id: 1, name: "Secto", icon: "fas fa-chart-line" }
  ];
  // Mock data for employees (replace with actual data source)
  const employees = [

  ];

  // Variables globales para el departamento seleccionado y el rango de fechas
  let selectedDepartmentId = departments[0].id;
  let selectedDepartmentName = departments[0].name;
  let currentStartDate = moment();
  let currentEndDate = moment();
  let selectedOptions = [];

  // Renderiza el menú de departamentos y la tabla de empleados
  renderDepartmentMenu();
  renderEmployeeTable(selectedDepartmentId, selectedDepartmentName);

  // Inicializa el daterangepicker solo una vez en el contenedor fijo
  initializeDatePicker();

  

  function initializeSearchButton(){
    const searchButton = document.querySelector('.searchButton');
    const selectElement = document.querySelector('.form-select');
    searchButton.addEventListener("click", () => {
      selectedOptions = Array.from(selectElement.selectedOptions).map(opt => ({
        id: opt.value,
        name: opt.innerText,
        email: opt.dataset.email,
      }));
      console.log("Departament ID:"+selectedDepartmentId);
      console.log("Usuarios seleccionados"+selectedOptions.length);
      const contentContainer = document.getElementById("employee-content");
      if (selectedOptions.length === 0) {
        renderEmployeeTable(selectedDepartmentId, selectedDepartmentName);
        let html = '<lottie-player src="./animation1.json" background="transparent"  speed="1"  style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 300px; height: 300px;" loop autoplay></lottie-player>';
        contentContainer.insertAdjacentHTML('beforeend', html);
        actualizarDatos();
      }else{
        renderEmployeeTable(selectedDepartmentId, selectedDepartmentName, null, true);
        let html = '<lottie-player src="./animation1.json" background="transparent"  speed="1"  style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 300px; height: 300px;" loop autoplay></lottie-player>';
        contentContainer.insertAdjacentHTML('beforeend', html);
        actualizarDatosIndividuales(selectedOptions);
        Array.from(selectElement.options).forEach(option => {
          option.selected = false;
        });
      }
    });

  }
  // Función para renderizar el menú de departamentos
  function renderDepartmentMenu() {
    const menuContainer = document.getElementById("department-menu");
    menuContainer.innerHTML = "";

    departments.forEach((department) => {
      const button = document.createElement("button");
      button.className = `nav-link text-start border-0 rounded-0 py-3 ${department.id === selectedDepartmentId ? "active" : ""}`;
      button.innerHTML = `<span class="department-icon"><i class="${department.icon}"></i></span> ${department.name}`;

      button.addEventListener("click", () => {
        // Actualiza el departamento seleccionado
        selectedDepartmentId = department.id;
        selectedDepartmentName = department.name;
        // Actualiza la clase active
        document.querySelectorAll("#department-menu .nav-link").forEach((el) => {
          el.classList.remove("active");
        });
        button.classList.add("active");

        // Actualiza la tabla de empleados para el nuevo departamento
        renderEmployeeTable(selectedDepartmentId, selectedDepartmentName);
      });

      menuContainer.appendChild(button);
    });

    // Crear y agregar el dropdown multiselección al final del menú
    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "nav-item";

    const dropdownButton = document.createElement("button");
    dropdownButton.className = "nav-link text-start border-0 rounded-0 py-3";
    dropdownButton.setAttribute("data-bs-toggle", "dropdown");
    dropdownButton.setAttribute("aria-expanded", "false");
    dropdownButton.innerHTML = "Select Users";  // Nombre inicial del dropdown

    const dropdownMenu = document.createElement("div");
    dropdownMenu.className = "dropdown-menu p-3";
    dropdownMenu.style.maxHeight = "600px";  // Ajustar la altura máxima
    dropdownMenu.style.overflowY = "auto";  // Hacer que el contenido sea desplazable

    // Primero, realiza una solicitud para obtener el archivo JSON
    obtenerRegistrosindividuales()
      .then(users => {
        populateDropdown(users);
      })
      .catch(error => {
        console.error('Error al obtener registros individuales:', error);
      });


  }

  // Función para renderizar la tabla de empleados (se actualiza el contenido sin tocar el input de fecha)
  function renderEmployeeTable(departmentId = null, selectedDepartmentName, apiResponses = null, isIndividual = null) {

    const contentContainer = document.getElementById("employee-content");
    const departmentEmployees = employees.filter((emp) => emp.departmentId === departmentId);
    const department = departments.find((dept) => dept.id === departmentId);
    let departmentName = department.name;
    if (isIndividual) {
      departmentName = 'Individual'
    }
    let html = `
          <h2>${departmentName} Inbox</h2>
          <div class="table-responsive">
            <table id="miTabla" class="table table-striped table-hover" style="max-height: 500px; overflow-y: scroll;">
              <thead class="table-light">
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
                  <td>${employee.position}</td>
                  <td><a href="mailto:${employee.email}" class="text-decoration-none">${employee.email}</a></td>
                  <td class="text-center">${employee.messagesReceived}</td>
                  <td class="text-center">${employee.messagesSent}</td>
                  <td class="text-center">${employee.avgReplyTime}</td>
                </tr>
      `;
    });

    if (apiResponses) {
      apiResponses.forEach((result) => {
        const totalSeconds = Math.round(result.apiData.metrics[2].value);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const formattedTime = `${hours}h ${minutes}m`;

        // Clase basada en la condición
        const timeClass = totalSeconds > 7200 ? 'text-danger' : 'text-success';

        html += `
          <tr>
            <td class="fw-medium">${result.record.name}</td>
            <td>${result.record.email || ''}</td>
            <td class="text-center">${result.apiData.metrics[0].value}</td>
            <td class="text-center">${result.apiData.metrics[1].value}</td>
            <td class="text-center ${timeClass}">${formattedTime}</td>
          </tr>
        `;
      });

      $(document).ready(function () {
        $('#miTabla').DataTable({
          pageLength: 25
        });
      });
    }

    html += `
              </tbody>
            </table>
          </div>
    `;
    contentContainer.innerHTML = html;
  }

  // Función que inicializa el daterangepicker
  function initializeDatePicker() {

    console.log('Datepicker inizialized');
    $('#daterange').daterangepicker({
      opens: 'left',
      locale: {
        format: 'YYYY-MM-DD',
        separator: ' - '
      },
      startDate: currentStartDate,
      endDate: currentEndDate,
      ranges: {
        'This Week': [moment().startOf('week'), moment().subtract(1, 'days')],
        'Last Month': [
          moment().subtract(1, 'month').startOf('month'),
          moment().subtract(1, 'month').endOf('month')
        ]
      }
    }, function (start, end, label) {
      
        currentStartDate = start;
        currentEndDate = end;
    });
  }

  // Función para actualizar los datos usando el rango actual y renderizar la tabla
  async function actualizarDatos() {
    const startTimestampSeconds = currentStartDate.unix();
    const endUTC5 = moment.tz(currentEndDate.format('YYYY-MM-DD'), 'America/New_York');
    const endTimestampSeconds = endUTC5.unix();

    try {
      const registros = await obtenerRegistrosPorInbox(selectedDepartmentName);
      console.log('Registros de', selectedDepartmentName + ":", registros);
      const data = await callApi(startTimestampSeconds, endTimestampSeconds, registros);
      console.log('Datos procesados:', data);
      const apiResponses = data.apiResponses || [];
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

  async function actualizarDatosIndividuales(inboxes) {
    const startTimestampSeconds = currentStartDate.unix();
    const endUTC5 = moment.tz(currentEndDate.format('YYYY-MM-DD'), 'America/New_York');
    const endTimestampSeconds = endUTC5.unix();
    try {
      const data = await callApiIndividuals(startTimestampSeconds, endTimestampSeconds, inboxes);
      console.log(data);
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


  // Función async para la llamada a la API
  async function callApi(timestampStart, timestampEnd, registros) {
    try {
      if (!timestampStart || !timestampEnd || !Array.isArray(registros)) {
        throw new Error('Faltan datos requeridos: timestampStart, timestampEnd o registros');
      }

      console.log('Sending to API:', { timestampStart, timestampEnd, registros });

      const response = await fetch(`http://${window.miVariable}:3001/getData`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestampStart, timestampEnd, registros }),
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Error del servidor: ${errorData.error || response.statusText || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log('Parsed data:', data);
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

      console.log('Sending to API:', { timestampStart, timestampEnd, inboxes });

      const response = await fetch(`http://${window.miVariable}:3001/getDataIndividuals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timestampStart, timestampEnd, inboxes }),
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Error del servidor: ${errorData.error || response.statusText || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log('Parsed data:', data);
      return data;
    } catch (error) {
      console.error('Error al llamar al API:', error.message);
      throw error;
    }
  }

  // Función async para obtener registros del JSON (users.json)
  async function obtenerRegistrosPorInbox(nombreInbox) {
    nombreInbox = !nombreInbox ? 'Secto' : nombreInbox;
    try {
      const respuesta = await fetch('./users.json');
      if (!respuesta.ok) {
        throw new Error(`Error al cargar el JSON: ${respuesta.status} ${respuesta.statusText}`);
      }
      const datos = await respuesta.json();
      return datos.filter(item => item.inbox === nombreInbox);
    } catch (error) {
      console.error('Error al obtener registros:', error);
      return [];
    }
  }

  async function obtenerRegistrosindividuales() {
    try {
      const respuesta = await fetch('./individual_inbox.json');
      if (!respuesta.ok) {
        throw new Error(`Error al cargar el JSON: ${respuesta.status} ${respuesta.statusText}`);
      }
      const datos = await respuesta.json();
      return datos;
    } catch (error) {
      console.error('Error al obtener registros:', error);
      return [];
    }
  }

  // Función para agregar los usuarios al dropdown
  function populateDropdown(users) {
    const menuContainer = document.getElementById("department-menu");
  
    // Crear wrapper para no duplicar si ya existe
    let userDropdownWrapper = document.getElementById("user-dropdown-wrapper");
    if (userDropdownWrapper) userDropdownWrapper.remove(); // Eliminamos la instancia anterior si ya existía
  
    userDropdownWrapper = document.createElement("div");
    userDropdownWrapper.id = "user-dropdown-wrapper";
    userDropdownWrapper.className = "mt-3"; // Espacio entre secciones
  
    // Crear el <select> múltiple
    const selectElement = document.createElement("select");
    selectElement.setAttribute("multiple", "multiple");
    selectElement.className = "form-select";
    selectElement.style.minHeight = "250px"; // Altura personalizada
  
    users.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.innerText = user.name;
      option.dataset.email = user.email; // Almacenar el email en un atributo data-email
      selectElement.appendChild(option);
    });
  
    // Agregar elementos al wrapper y luego al contenedor principal
    userDropdownWrapper.appendChild(selectElement);
    menuContainer.appendChild(userDropdownWrapper);
    
    // Mover la inicialización del botón de búsqueda aquí, si es necesario
    initializeSearchButton();
  }
  
});


