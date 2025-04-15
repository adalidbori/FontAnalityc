window.miVariable = "192.168.1.196";
document.addEventListener("DOMContentLoaded", () => {

  // Mock data for departments (replace with actual data source)
  const departments = [
    { id: 1, name: "Secto", icon: "fas fa-chart-line" },
    { id: 2, name: "Billing", icon: "fa-solid fa-calculator" },
    { id: 3, name: "Concierge", icon: "fas fa-users" },
    { id: 4, name: "Exports", icon: "fas fa-code" },
    { id: 5, name: "Freight", icon: "fa-solid fa-truck" },
    { id: 6, name: "Pricing", icon: "fa-solid fa-money-bill" },
    { id: 7, name: "ISF", icon: "fa-solid fa-file" },
    { id: 8, name: "Arribal Notice", icon: "fas fa-bullhorn" },
    { id: 9, name: "Distribution", icon: "fa-solid fa-road" }
  ];
  // Mock data for employees (replace with actual data source)
  const employees = [

  ];

  // Variables globales para el departamento seleccionado y el rango de fechas
  let selectedDepartmentId = departments[0].id;
  let selectedDepartmentName = departments[0].name;
  let currentStartDate = moment();
  let currentEndDate = moment();

  // Renderiza el menú de departamentos y la tabla de empleados
  renderDepartmentMenu();
  renderEmployeeTable(selectedDepartmentId, selectedDepartmentName);

  // Inicializa el daterangepicker solo una vez en el contenedor fijo
  initializeDatePicker();

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
        // Opcional: actualiza los datos con el rango actual
        //actualizarDatos();

        const defaultStartDate = moment();
        const defaultEndDate = moment();

        currentStartDate = defaultStartDate;
        currentEndDate = defaultEndDate;
        // Obtiene la instancia del daterangepicker y actualiza sus fechas
        const picker = $('#daterange').data('daterangepicker');
        if (picker) {
          picker.setStartDate(defaultStartDate);
          picker.setEndDate(defaultEndDate);
          // Si autoUpdateInput está activado, actualiza el valor del input
          $('#daterange').val(defaultStartDate.format('YYYY-MM-DD') + ' - ' + defaultEndDate.format('YYYY-MM-DD'));
        }
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
  function renderEmployeeTable(departmentId, selectedDepartmentName, apiResponses = null) {
    const contentContainer = document.getElementById("employee-content");
    const departmentEmployees = employees.filter((emp) => emp.departmentId === departmentId);
    const department = departments.find((dept) => dept.id === departmentId);

    let html = `
          <h2>${department.name} Inbox</h2>
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

      // Actualiza las variables globales cuando el usuario modifica el rango
      const contentContainer = document.getElementById("employee-content");

      let html = '<lottie-player src="./animation1.json" background="transparent"  speed="1"  style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 300px; height: 300px;" loop autoplay></lottie-player>';
      contentContainer.insertAdjacentHTML('beforeend', html);
      currentStartDate = start;
      currentEndDate = end;

      console.log('Rango seleccionado:', start.format('YYYY-MM-DD'), 'a', end.format('YYYY-MM-DD'));
      console.log('Start Timestamp (seconds):', start.unix());

      const endUTC5 = moment.tz(end.format('YYYY-MM-DD'), 'America/New_York');
      console.log('End Timestamp UTC-5 (seconds):', endUTC5.unix());

      // Actualiza los datos con el nuevo rango
      actualizarDatos();
    });
  }

  // Función para actualizar los datos usando el rango actual y renderizar la tabla
  async function actualizarDatos() {
    console.log('Actualizando datos');
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

  // Función async para la llamada a la API
  async function callApi(timestampStart, timestampEnd, registros) {
    try {
      if (!timestampStart || !timestampEnd || !Array.isArray(registros)) {
        throw new Error('Faltan datos requeridos: timestampStart, timestampEnd o registros');
      }

      console.log('Sending to API:', { timestampStart, timestampEnd, registros });

      const response = await fetch(`http://${window.miVariable || 'localhost'}:3001/getData`, {
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
      selectElement.appendChild(option);
    });

    // Crear botón Apply
    const applyButton = document.createElement("button");
    applyButton.className = "btn btn-primary mt-2";
    applyButton.innerText = "Apply";

    applyButton.addEventListener("click", () => {
      const selectedOptions = Array.from(selectElement.selectedOptions).map(opt => opt.value);
      if (selectedOptions.length > 10) {
        // Deselecciona la última opción seleccionada
        selectedOptions[selectedOptions.length - 1].selected = false;

        // Alerta al usuario (puedes usar modal o toast si prefieres)
        alert("You can only select up to 10 users.");
      }else{
        console.log("Usuarios seleccionados:", selectedOptions);
      }
    });

    // Agregar elementos al wrapper y luego al contenedor principal
    userDropdownWrapper.appendChild(selectElement);
    userDropdownWrapper.appendChild(applyButton);
    menuContainer.appendChild(userDropdownWrapper);
  }

});


